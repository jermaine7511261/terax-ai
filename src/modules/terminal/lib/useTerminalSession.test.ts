// biome-ignore-all lint/style/noNonNullAssertion: 测试断言数据必然存在
// @vitest-environment jsdom
// Tests for the module-level session lifecycle of useTerminalSession.ts:
// session creation, pty onData/onExit wiring, resize/kick/close forwarding,
// getBuffer buffer paging (live slot + persisted snapshot), and spawn-failure
// handling. Heavy renderer/xterm/OSC modules are mocked; the real `sessions`
// map and `DormantRing` are exercised through the hook and exported helpers.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prefsState = vi.hoisted(() => ({
  zoomLevel: 1,
  terminalLetterSpacing: 0,
  terminalScrollback: 1000,
  terminalWebglEnabled: false,
  terminalCursorBlink: true,
  backgroundKind: "image",
  backgroundImageId: "",
  terminalShell: "bash",
}));

const openPty = vi.hoisted(() => vi.fn());

// Every rendererPool symbol the module imports becomes a mock. configureRendererPool
// captures the real adapter (built inside useTerminalSession.ts) so tests can drive
// resizePty / kickPty / writeToPty / storeSnapshot against the live session state.
const rendererPool = vi.hoisted(() => {
  const names = [
    "acquireSlot",
    "applyBackgroundActive",
    "applyCursorBlink",
    "applyLetterSpacing",
    "applyTheme",
    "applyScrollback",
    "applyTerminalFont",
    "applyWebglPreference",
    "configureRendererPool",
    "discardRetainedSlot",
    "disposeLeafSlot",
    "focusSlot",
    "getLiveSlotForLeaf",
    "getSlotForLeaf",
    "isLeafAltScreen",
    "parkLeafSlot",
    "poolSize",
    "poolSlotStats",
    "refreshLeafSlot",
    "releaseSlot",
    "setSlotFocused",
  ];
  const m: Record<string, ReturnType<typeof vi.fn>> = {} as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
  for (const n of names) m[n] = vi.fn();
  m.configureRendererPool = vi.fn((a: unknown) => {
    (m as Record<string, unknown>).__adapter = a;
  });
  return m;
});

const agentActivity = vi.hoisted(() => ({
  ensureAgentActivityListener: vi.fn(),
  isAgentActivePty: vi.fn(() => false),
}));

const fontsMock = vi.hoisted(() => ({ ensureMonoFontsLoaded: vi.fn() }));
const platformMock = vi.hoisted(() => ({ invoke: vi.fn() }));
const snapshotMock = vi.hoisted(() => ({
  clearBusyMarker: vi.fn(async () => undefined),
  clearTerminalSnapshot: vi.fn(async () => undefined),
  hasBusyMarker: vi.fn(async () => false),
  loadTerminalSnapshot: vi.fn(async () => null),
  saveBusyMarker: vi.fn(async () => undefined),
  saveTerminalSnapshot: vi.fn(async () => undefined),
}));
const oscMock = vi.hoisted(() => {
  const m = {
    __cwdCb: null as null | ((cwd: string) => void),
    createShellIntegrationState: vi.fn(() => ({})),
    registerCwdHandler: vi.fn((_term: unknown, cb: (cwd: string) => void) => {
      m.__cwdCb = cb;
      return vi.fn();
    }),
    registerOsc52ClipboardHandler: vi.fn(() => vi.fn()),
    registerPromptTracker: vi.fn(() => ({ dispose: vi.fn() })),
  };
  return m;
});
const useTerminalFont = vi.hoisted(() =>
  vi.fn(() => ({ fontFamily: "monospace", fontWeight: "normal", fontSize: 14 })),
);

vi.mock("@/lib/fonts", () => fontsMock);
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: Object.assign(
    (sel: (s: typeof prefsState) => unknown) => sel(prefsState),
    { getState: () => prefsState },
  ),
}));
vi.mock("@/platform", () => platformMock);
vi.mock("../block/lib/blockDecorations", () => ({
  BlockDecorations: class {},
}));
vi.mock("./osc-handlers", () => oscMock);
vi.mock("./pty-bridge", () => ({ openPty }));
vi.mock("./agentActivity", () => agentActivity);
vi.mock("./sessionSnapshot", () => snapshotMock);
vi.mock("./rendererPool", () => rendererPool);
vi.mock("./useTerminalFont", () => ({ useTerminalFont }));

import {
  blockWatermarkState,
  disposeSession,
  interruptLeaf,
  leafCwd,
  respawnSession,
  submitToLeaf,
  useTerminalSession,
  whenSessionReady,
  writeToSession,
} from "./useTerminalSession";

const enc = new TextEncoder();
const dec = new TextDecoder();

type FakePty = {
  id: number;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  bufferLines: ReturnType<typeof vi.fn>;
};

function makePty(): FakePty {
  return {
    id: 999,
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    bufferLines: vi.fn(async () => [[], 0, 0] as [string[], number, number]),
  };
}

let pty: FakePty;
let lastAcquire: {
  registerOsc: (term: unknown) => (() => void)[];
  drainRing: (write: (b: Uint8Array) => void) => void;
} | null;

function freshContainer() {
  return { current: document.createElement("div") };
}

function mount(leafId: number, options: Partial<Parameters<typeof useTerminalSession>[0]> = {}) {
  const container = freshContainer();
  return { container, ...renderHook(() => useTerminalSession({ leafId, container, visible: true, ...options })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  pty = makePty();
  lastAcquire = null;
  oscMock.__cwdCb = null;
  // Drop any session left behind by a previous test so leafIds start clean.
  disposeSession(1);
  disposeSession(2);
  openPty.mockImplementation(async () => pty);
  fontsMock.ensureMonoFontsLoaded.mockResolvedValue(undefined);
  platformMock.invoke.mockResolvedValue(false);
  agentActivity.isAgentActivePty.mockReturnValue(false);
  rendererPool.getLiveSlotForLeaf.mockReturnValue(undefined);
  rendererPool.getSlotForLeaf.mockReturnValue(undefined);
  rendererPool.isLeafAltScreen.mockReturnValue(false);
  rendererPool.poolSize.mockReturnValue(0);
  rendererPool.poolSlotStats.mockReturnValue([]);
  rendererPool.acquireSlot.mockImplementation((opts: unknown) => {
    lastAcquire = opts as typeof lastAcquire;
  });
  // Ensure the session "ready" promise (awaits document.fonts.ready) always resolves.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});

describe("useTerminalSession — session creation", () => {
  it("creates a session and spawns a pty with default dims once ready", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    expect(openPty).toHaveBeenCalledWith(
      80,
      24,
      expect.objectContaining({ onData: expect.any(Function), onExit: expect.any(Function) }),
      undefined,
      false,
      "bash",
      undefined,
    );
  });

  it("uses the configured shell from preferences", async () => {
    prefsState.terminalShell = "fish";
    try {
      mount(1);
      await waitFor(() => expect(openPty).toHaveBeenCalled());
      const args = openPty.mock.calls[0];
      expect(args[5]).toBe("fish");
    } finally {
      prefsState.terminalShell = "bash";
    }
  });

  it("returns null from getBuffer once the session is disposed", async () => {
    const { result } = mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    disposeSession(1);
    expect(result.current.getBuffer()).toBeNull();
  });
});

describe("useTerminalSession — pty callback wiring", () => {
  it("routes onData bytes to the bound slot's term.write", async () => {
    const termWrite = vi.fn();
    rendererPool.getLiveSlotForLeaf.mockReturnValue({ term: { write: termWrite } });
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const { onData } = openPty.mock.calls[0][2] as { onData: (b: Uint8Array) => void };
    const bytes = enc.encode("hello");
    onData(bytes);
    expect(termWrite).toHaveBeenCalledWith(bytes);
  });

  it("queues onData into the dormant ring when no live slot is bound", async () => {
    rendererPool.getLiveSlotForLeaf.mockReturnValue(undefined);
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const { onData } = openPty.mock.calls[0][2] as { onData: (b: Uint8Array) => void };
    onData(enc.encode("queued"));
    expect(lastAcquire).not.toBeNull();
    const drained: string[] = [];
    lastAcquire?.drainRing((b) => drained.push(dec.decode(b)));
    expect(drained.join("")).toBe("queued");
  });

  it("fires onExit and marks the shell exited", async () => {
    const onExit = vi.fn();
    mount(1, { onExit });
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const { onExit: cb } = openPty.mock.calls[0][2] as { onExit: (code: number) => void };
    cb(0);
    expect(onExit).toHaveBeenCalledWith(0);
    // Shell exited ⇒ further input is refused.
    expect(writeToSession(1, "x")).toBe(false);
  });

  it("wires the cwd handler and marks the session ready on first cwd", async () => {
    const onCwd = vi.fn();
    mount(1, { onCwd });
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    lastAcquire?.registerOsc({} as never);
    expect(oscMock.registerCwdHandler).toHaveBeenCalled();
    const cb = oscMock.__cwdCb!;
    cb("/repo/src");
    expect(onCwd).toHaveBeenCalledWith("/repo/src");
    expect(leafCwd(1)).toBe("/repo/src");
    // Once the cwd handler has fired, the session is immediately ready.
    await expect(whenSessionReady(1, 5000)).resolves.toBeUndefined();
  });
});

describe("useTerminalSession — input forwarding", () => {
  it("writeToSession forwards input to the pty", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    expect(writeToSession(1, "echo hi\n")).toBe(true);
    expect(pty.write).toHaveBeenCalledWith("echo hi\n");
  });

  it("submitToLeaf wraps multiline text in bracketed paste and single-line with CR", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    submitToLeaf(1, "a\nb");
    expect(pty.write).toHaveBeenLastCalledWith("\x1b[200~a\nb\x1b[201~\r");
    submitToLeaf(1, "ls");
    expect(pty.write).toHaveBeenLastCalledWith("ls\r");
  });

  it("interruptLeaf writes SIGINT to the pty", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    interruptLeaf(1);
    expect(pty.write).toHaveBeenLastCalledWith("\x03");
  });
});

describe("useTerminalSession — resize / kick / close forwarding", () => {
  it("resizePty records dims and forwards to the pty", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const adapter = rendererPool.__adapter as unknown as { resolveLeaf: (id: number) => { resizePty: (c: number, r: number) => void } };
    adapter.resolveLeaf(1).resizePty(120, 30);
    expect(pty.resize).toHaveBeenCalledWith(120, 30);
  });

  it("kickPty bumps rows to force SIGWINCH then restores", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const adapter = rendererPool.__adapter as unknown as { resolveLeaf: (id: number) => { kickPty: (c: number, r: number) => Promise<void> } };
    await adapter.resolveLeaf(1).kickPty(100, 20);
    expect(pty.resize).toHaveBeenNthCalledWith(1, 100, 21);
    expect(pty.resize).toHaveBeenNthCalledWith(2, 100, 20);
  });

  it("disposeSession closes the pty and drops the session", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    disposeSession(1);
    expect(pty.close).toHaveBeenCalledTimes(1);
    expect(writeToSession(1, "x")).toBe(false);
  });

  it("respawnSession closes and re-opens the pty", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalledTimes(1));
    await respawnSession(1);
    expect(pty.close).toHaveBeenCalledTimes(1);
    expect(openPty).toHaveBeenCalledTimes(2);
  });
});

describe("useTerminalSession — getBuffer paging", () => {
  it("returns the tail lines from the live buffer", async () => {
    const lines = ["a", "b", "c", "d", "e"];
    rendererPool.getLiveSlotForLeaf.mockReturnValue({
      term: { buffer: { active: { length: 5, getLine: (i: number) => ({ translateToString: () => lines[i] }) } } },
    });
    const { result } = mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    expect(result.current.getBuffer(200)).toBe("a\nb\nc\nd\ne");
    expect(result.current.getBuffer(2)).toBe("d\ne");
  });

  it("drops trailing empty lines and honors maxLines on the live buffer", async () => {
    const lines = ["x", "y", "", "", ""];
    rendererPool.getLiveSlotForLeaf.mockReturnValue({
      term: { buffer: { active: { length: 5, getLine: (i: number) => ({ translateToString: () => lines[i] }) } } },
    });
    const { result } = mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    expect(result.current.getBuffer(200)).toBe("x\ny");
  });

  it("strips ANSI and pages the persisted snapshot", async () => {
    rendererPool.getLiveSlotForLeaf.mockReturnValue(undefined);
    const { result } = mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const adapter = rendererPool.__adapter as unknown as {
      storeSnapshot: (id: number, out: { snapshot: string; cols: number; rows: number; altScreen: boolean }) => void;
    };
    adapter.storeSnapshot(1, { snapshot: "\x1b[31mred\x1b[0m\nline2\n", cols: 80, rows: 24, altScreen: false });
    expect(result.current.getBuffer(10)).toBe("red\nline2");
    expect(result.current.getBuffer(2)).toBe("line2");
  });
});

describe("useTerminalSession — error handling", () => {
  it("surfaces a spawn failure into the grid and disables further input", async () => {
    openPty.mockRejectedValue(new Error("boom"));
    const termWrite = vi.fn();
    rendererPool.getLiveSlotForLeaf.mockReturnValue({ term: { write: termWrite } });
    mount(1);
    await waitFor(() => expect(termWrite).toHaveBeenCalled());
    const all = termWrite.mock.calls.map((c) => dec.decode(c[0])).join("");
    expect(all).toContain("failed to start shell");
    // openPtyWithRetry retries once before surfacing the failure.
    expect(openPty).toHaveBeenCalledTimes(2);
    expect(writeToSession(1, "x")).toBe(false);
  });

  it("leafHasForegroundProcess forwards the platform result", async () => {
    platformMock.invoke.mockResolvedValue(true);
    const { leafHasForegroundProcess } = await import("./useTerminalSession");
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    await expect(leafHasForegroundProcess(1)).resolves.toBe(true);
    expect(platformMock.invoke).toHaveBeenCalledWith("pty_has_foreground_process", { id: 999 });
  });
});

describe("useTerminalSession — ready + watermark helpers", () => {
  it("whenSessionReady resolves after a timeout when a session never becomes ready", async () => {
    await expect(whenSessionReady(99, 5)).resolves.toBeUndefined();
  });

  it("disposeSession resolves pending ready waiters", async () => {
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    const waiter = whenSessionReady(1, 5000);
    disposeSession(1);
    await expect(waiter).resolves.toBeUndefined();
  });

  it("blockWatermarkState reports dead for missing and hidden for unbound sessions", async () => {
    expect(blockWatermarkState(99)).toBe("dead");
    mount(1);
    await waitFor(() => expect(openPty).toHaveBeenCalled());
    expect(blockWatermarkState(1)).toBe("hidden");
  });
});

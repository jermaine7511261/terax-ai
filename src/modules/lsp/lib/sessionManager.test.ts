import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

// --- mocks for the module-graph dependencies sessionManager pulls in ---
const transportStart = vi.hoisted(() => vi.fn(async () => {}));
const transportClose = vi.hoisted(() => vi.fn());
const transportInstances = vi.hoisted(() => [] as any[]);
const mockTransportClass = vi.hoisted(() => {
  class MockTransport {
    exitInfo: { code: number | null; stderrTail: string; reason: string | null } | null =
      null;
    start = transportStart;
    close = transportClose;
    send = vi.fn();
    constructor() {
      transportInstances.push(this);
    }
  }
  return MockTransport;
});

const clientClose = vi.hoisted(() => vi.fn());
const clientShutdown = vi.hoisted(() => vi.fn(async () => {}));
const clientDidClose = vi.hoisted(() => vi.fn());
const clientDidSave = vi.hoisted(() => vi.fn());
const lspInteractionsMock = vi.hoisted(() => vi.fn(() => ({})));
const lspTransportExtMock = vi.hoisted(() => vi.fn(() => ({})));
const clientOnClose = vi.hoisted(() => {
  const fns: (() => void)[] = [];
  return fns;
});
const mockClientClass = vi.hoisted(() => {
  class MockClient {
    static hostPid: number | null = null;
    initializePromise = Promise.resolve();
    close = clientClose;
    shutdownGracefully = clientShutdown;
    textDocumentDidClose = clientDidClose;
    textDocumentDidSave = clientDidSave;
    constructor(opts: { onClose: () => void }) {
      clientOnClose.push(opts.onClose);
    }
  }
  return MockClient;
});

const prefsState = vi.hoisted(() => ({
  lspCustomServers: {},
  lspActivation: {} as Record<string, string>,
}));
const serverForLanguageMock = vi.hoisted(() => vi.fn());
const detectBinaryMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => "/usr/bin/ts-server"),
);
const openFileMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: vi.fn(() => "local"),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => prefsState,
    subscribe: vi.fn(() => () => {}),
  },
}));
vi.mock("./presets", () => ({
  serverForLanguage: serverForLanguageMock,
}));
vi.mock("./detect", () => ({ detectBinary: detectBinaryMock }));
vi.mock("./navigator", () => ({ getLspNavigator: vi.fn(() => ({ openFile: openFileMock })) }));
vi.mock("./runtimeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtimeStore")>();
  return actual;
});
vi.mock("./transport", () => ({ TauriLspTransport: mockTransportClass }));
vi.mock("./client", () => ({
  YametLspClient: mockClientClass,
  lspInteractions: lspInteractionsMock,
  languageServerWithTransport: lspTransportExtMock,
  SynchronizationMethod: { Incremental: 2 },
}));

import { useLspRuntimeStore } from "./runtimeStore";
import {
  acquireDocExtension,
  notifyDocumentSaved,
  restartPresetSessions,
  sessionsForPath,
  stopPresetSessions,
} from "./sessionManager";

const preset = {
  id: "typescript",
  name: "TypeScript",
  command: "ts-server",
  args: ["--stdio"],
  languages: { ts: "typescript" },
  rootMarkers: ["tsconfig.json"],
};

function enablePreset() {
  prefsState.lspActivation[preset.id] = "enabled";
}

beforeEach(async () => {
  invokeMock.mockReset();
  toastMock.error.mockClear();
  transportStart.mockClear();
  transportClose.mockClear();
  transportInstances.length = 0;
  clientClose.mockClear();
  clientShutdown.mockClear();
  clientDidClose.mockClear();
  clientDidSave.mockClear();
  clientOnClose.length = 0;
  serverForLanguageMock.mockReset();
  detectBinaryMock.mockReset();
  detectBinaryMock.mockResolvedValue("/usr/bin/ts-server");
  openFileMock.mockClear();
  enablePreset();
  serverForLanguageMock.mockReturnValue(preset);
  useLspRuntimeStore.setState({
    sessions: {},
    detected: {},
    generations: {},
    failed: {},
  });
  mockClientClass.hostPid = null;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "lsp_resolve_root") return Promise.resolve("/repo");
    if (cmd === "lsp_host_pid") return Promise.resolve(1234);
    return Promise.resolve(undefined);
  });
  await stopPresetSessions(preset.id);
});

const root = "/repo";

describe("acquireDocExtension guards", () => {
  it("returns null when no preset matches the language", async () => {
    serverForLanguageMock.mockReturnValue(null);
    expect(await acquireDocExtension("/repo/a.ts", "ts")).toBeNull();
  });

  it("returns null when the preset is not enabled", async () => {
    prefsState.lspActivation[preset.id] = "disabled";
    expect(await acquireDocExtension("/repo/a.ts", "ts")).toBeNull();
  });

  it("returns null when the binary is not detected", async () => {
    detectBinaryMock.mockResolvedValue(null);
    expect(await acquireDocExtension("/repo/a.ts", "ts")).toBeNull();
  });

  it("returns null when no project root resolves", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "lsp_resolve_root" ? Promise.resolve(null) : Promise.resolve(undefined),
    );
    expect(await acquireDocExtension("/repo/a.ts", "ts")).toBeNull();
  });

  it("returns null when the root resolve throws", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "lsp_resolve_root" ? Promise.reject(new Error("no markers")) : Promise.resolve(undefined),
    );
    expect(await acquireDocExtension("/repo/a.ts", "ts")).toBeNull();
  });
});

describe("acquireDocExtension session lifecycle", () => {
  it("creates a session, spawns the server, and returns a handle", async () => {
    const handle = await acquireDocExtension(`${root}/a.ts`, "ts");
    expect(handle).not.toBeNull();
    expect(transportStart).toHaveBeenCalledWith(
      expect.objectContaining({ command: "ts-server", args: ["--stdio"], root }),
    );
    const s = useLspRuntimeStore.getState().sessions;
    expect(Object.values(s)).toHaveLength(1);
    expect(Object.values(s)[0]).toMatchObject({ status: "running" });
    handle!.release();
    expect(clientDidClose).toHaveBeenCalled();
  });

  it("releases the handle idempotently", async () => {
    const handle = await acquireDocExtension(`${root}/a.ts`, "ts");
    handle!.release();
    const calls = clientDidClose.mock.calls.length;
    handle!.release();
    expect(clientDidClose.mock.calls.length).toBe(calls);
  });

  it("reuses an existing session for the same root", async () => {
    await acquireDocExtension(`${root}/a.ts`, "ts");
    await acquireDocExtension(`${root}/b.ts`, "ts");
    expect(transportStart).toHaveBeenCalledTimes(1);
    expect(Object.values(useLspRuntimeStore.getState().sessions)).toHaveLength(1);
  });

  it("sessionsForPath returns sessions whose root covers the path", async () => {
    await acquireDocExtension(`${root}/a.ts`, "ts");
    expect(sessionsForPath(`${root}/sub/deep.ts`).map((m) => m.root)).toEqual([root]);
    expect(sessionsForPath("/other/x.ts")).toEqual([]);
  });

  it("notifyDocumentSaved notifies matching open refs", async () => {
    const handle = await acquireDocExtension(`${root}/a.ts`, "ts");
    const uri = `file://${root}/a.ts`;
    notifyDocumentSaved(`${root}/a.ts`);
    expect(clientDidSave).toHaveBeenCalledWith(uri);
    handle!.release();
  });

  it("stopPresetSessions closes matching sessions gracefully", async () => {
    await acquireDocExtension(`${root}/a.ts`, "ts");
    await stopPresetSessions(preset.id);
    expect(clientShutdown).toHaveBeenCalled();
    expect(transportClose).toHaveBeenCalled();
    expect(Object.values(useLspRuntimeStore.getState().sessions)).toHaveLength(0);
  });

  it("restartPresetSessions clears failure and bumps the generation", async () => {
    const store = useLspRuntimeStore.getState();
    store.setFailed(preset.id, "crash loop");
    await restartPresetSessions(preset.id);
    expect(useLspRuntimeStore.getState().failed[preset.id]).toBeUndefined();
    expect(useLspRuntimeStore.getState().generations[preset.id]).toBeGreaterThan(0);
  });
});

describe("crash handling", () => {
  it("marks a session failed and surfaces a toast when the server exits with a reason", async () => {
    await acquireDocExtension(`${root}/a.ts`, "ts");
    // The first client was constructed for the a.ts session.
    const transport = transportInstances[0];
    transport.exitInfo = { code: 9, stderrTail: "OOM", reason: "budget" };
    // Simulate a real server exit via the client's onClose callback.
    const onClose = clientOnClose[0];
    onClose();
    expect(toastMock.error).toHaveBeenCalled();
    expect(useLspRuntimeStore.getState().failed[preset.id]).toBe("budget");
    expect(useLspRuntimeStore.getState().sessions).toEqual({});
  });

  it("sets the failed reason from the stderr tail when crashing repeatedly", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    for (let i = 0; i < 3; i++) {
      await acquireDocExtension(`${root}/a.ts`, "ts");
      const transport = transportInstances[i];
      transport.exitInfo = { code: 1, stderrTail: "crash", reason: null };
      clientOnClose[clientOnClose.length - 1]();
    }
    expect(useLspRuntimeStore.getState().failed[preset.id]).toContain("crash");
    vi.restoreAllMocks();
  });
});

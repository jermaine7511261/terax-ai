import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({
  native: { readFile: vi.fn(), writeFile: vi.fn() },
}));
vi.mock("../store/memoryStore", () => ({
  formatSessionMemory: vi.fn(() => null),
  getSessionMemory: vi.fn(() => []),
  recallTop: vi.fn((lines) => lines.slice(0, 3)),
}));
vi.mock("./agent", () => ({
  runAgentStream: vi.fn(),
}));
vi.mock("@/modules/mcp", () => ({
  useMcpStore: { getState: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }) },
}));

import { native } from "./native";
import { runAgentStream } from "./agent";
import {
  appendProjectMemory,
  MEMORY_NOTE,
  MEMORY_NOTE_END,
  mergeProjectMemory,
  parseBlock,
  rebuildBlock,
  removeProjectMemory,
  renderEntry,
  scrubMemoryEcho,
  createContextAwareTransport,
  stripContextBlock,
  updateProjectMemory,
} from "./transport";
import type { UIMessage } from "@ai-sdk/react";
import { getSessionMemory } from "../store/memoryStore";

const mockReadFile = vi.mocked(native.readFile);
const mockWriteFile = vi.mocked(native.writeFile);
const mockRunAgentStream = vi.mocked(runAgentStream);

const MEM_START = "<!-- yamet-project-memory:start -->";
const MEM_END = "<!-- yamet-project-memory:end -->";

beforeEach(() => {
  mockReadFile.mockReset();
  mockWriteFile.mockReset();
  mockRunAgentStream.mockReset();
});

describe("renderEntry / parseBlock / rebuildBlock", () => {
  it("renderEntry flattens newlines to spaces", () => {
    expect(renderEntry({ content: "a\nb" })).toBe("- a b");
  });

  it("parseBlock returns everything as prefix when no markers exist", () => {
    expect(parseBlock("just text")).toEqual({ prefix: "just text", lines: [], suffix: "" });
  });

  it("parseBlock extracts only non-empty lines from the managed block", () => {
    const content = `head\n${MEM_START}\n- a\n\n- b\n${MEM_END}\ntail`;
    const block = parseBlock(content);
    expect(block.prefix).toBe("head\n");
    expect(block.lines).toEqual(["- a", "- b"]);
    expect(block.suffix).toBe("\ntail");
  });

  it("parseBlock returns prefix only when end marker precedes start", () => {
    const content = `${MEM_END}x${MEM_START}`;
    expect(parseBlock(content).lines).toEqual([]);
  });

  it("rebuildBlock emits no markers when there are no lines", () => {
    expect(rebuildBlock({ prefix: "p", lines: [], suffix: "s" })).toBe("ps");
  });

  it("rebuildBlock reassembles markers around lines with newline separators", () => {
    const out = rebuildBlock({ prefix: "p\n", lines: ["- a", "- b"], suffix: "\nt" });
    expect(out).toBe(`p\n${MEM_START}\n- a\n- b\n${MEM_END}\nt`);
  });
});

describe("mergeProjectMemory", () => {
  it("returns null when both sources are empty", () => {
    expect(mergeProjectMemory(null, null)).toBeNull();
    expect(mergeProjectMemory("", "   ")).toBeNull();
  });

  it("merges and dedupes lines case-insensitively", () => {
    const out = mergeProjectMemory("- Alpha\n- beta", "- Beta\n- gamma");
    expect(out).toBe("- Alpha\n- beta\n- gamma");
  });

  it("skips blank lines", () => {
    expect(mergeProjectMemory("  ", "- x")).toBe("- x");
  });

  it("caps the total at YAMET_MD_MAX_BYTES", () => {
    const big = `- ${"x".repeat(40000)}`;
    const out = mergeProjectMemory(big, "- y");
    expect(out?.length).toBe(32768);
  });
});

describe("appendProjectMemory", () => {
  it("appends a new entry and writes back", async () => {
    mockReadFile.mockResolvedValue({ kind: "text", content: `# YAMET\n${MEM_START}\n- a\n${MEM_END}`, size: 0 });
    mockWriteFile.mockResolvedValue(undefined);

    const res = await appendProjectMemory("/ws", { id: "1", content: "b", createdAt: 0 });
    expect(res).toEqual({ ok: true, path: "/ws/YAMET.md" });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile.mock.calls[0][1]).toContain("- a");
    expect(mockWriteFile.mock.calls[0][1]).toContain("- b");
  });

  it("does not duplicate an existing line", async () => {
    mockReadFile.mockResolvedValue({
      kind: "text",
      content: `${MEM_START}\n- a\n${MEM_END}`,
      size: 0,
    });
    await appendProjectMemory("/ws", { id: "1", content: "a", createdAt: 0 });
    expect(mockWriteFile.mock.calls[0][1]).not.toContain("- a\n- a");
  });

  it("returns ok:false when the write fails", async () => {
    mockReadFile.mockResolvedValue({ kind: "text", content: "", size: 0 });
    mockWriteFile.mockRejectedValue(new Error("disk full"));
    const res = await appendProjectMemory("/ws", { id: "1", content: "a", createdAt: 0 });
    expect(res.ok).toBe(false);
  });
});

describe("updateProjectMemory / removeProjectMemory", () => {
  it("updateProjectMemory replaces an existing line", async () => {
    mockReadFile.mockResolvedValue({ kind: "text", content: `${MEM_START}\n- a\n${MEM_END}`, size: 0 });
    mockWriteFile.mockResolvedValue(undefined);
    await updateProjectMemory("/ws", { id: "1", content: "a", createdAt: 0 });
    expect(mockWriteFile.mock.calls[0][1]).toBe(`${MEM_START}\n- a\n${MEM_END}`);
  });

  it("removeProjectMemory is idempotent when nothing matches", async () => {
    mockReadFile.mockResolvedValue({ kind: "text", content: `${MEM_START}\n- a\n${MEM_END}`, size: 0 });
    const res = await removeProjectMemory("/ws", "zzz");
    expect(res).toEqual({ ok: true, path: "/ws/YAMET.md" });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("removeProjectMemory drops a matching line", async () => {
    mockReadFile.mockResolvedValue({ kind: "text", content: `${MEM_START}\n- a\n- b\n${MEM_END}`, size: 0 });
    mockWriteFile.mockResolvedValue(undefined);
    const res = await removeProjectMemory("/ws", "a");
    expect(res).toEqual({ ok: true, path: "/ws/YAMET.md" });
    expect(mockWriteFile.mock.calls[0][1]).toBe(`${MEM_START}\n- b\n${MEM_END}`);
  });
});

describe("stripContextBlock", () => {
  it("removes a leading terminal-context block", () => {
    expect(
      stripContextBlock("<terminal-context>\ntext\n</terminal-context>\nhello"),
    ).toBe("hello");
  });

  it("leaves text without the block unchanged", () => {
    expect(stripContextBlock("plain")).toBe("plain");
  });
});

describe("scrubMemoryEcho (P1-4 marker isolation)", () => {
  const injected = `${MEMORY_NOTE}\n- use pnpm\n${MEMORY_NOTE_END}`;

  it("strips a verbatim echo of the injected memory block", () => {
    const reply = `I'll do that.\n${injected}\nLet's proceed.`;
    expect(scrubMemoryEcho(reply, injected)).toBe("I'll do that.\nLet's proceed.");
  });

  it("leaves text unchanged when there was no injected memory", () => {
    expect(scrubMemoryEcho("plain reply", null)).toBe("plain reply");
  });

  it("strips isolated note markers via the fallback path", () => {
    const reply = `${MEMORY_NOTE} some echoed line ${MEMORY_NOTE_END} done`;
    // The echoed content between the markers is also scrubbed, leaving only
    // the text after the closing marker.
    expect(scrubMemoryEcho(reply, injected)).toBe(" done");
  });
});

describe("createContextAwareTransport run() (env injection + memory recall)", () => {
  function makeDeps(overrides: Record<string, unknown> = {}) {
    return {
      getKeys: () => ({}),
      getModelId: () => "deepseek-v4",
      getCustomInstructions: () => "",
      getAgentPersona: () => null,
      getLive: () => ({
        cwd: "/ws1/sub",
        terminalPrivate: true,
        workspaceRoot: "/ws1",
        activeFile: "/ws1/a.ts",
      }),
      toolContext: { getSessionId: () => "sess-1" },
      onStep: vi.fn(),
      onUsage: vi.fn(),
      onCompact: vi.fn(),
      onFinishMeta: vi.fn(),
      onPhase: vi.fn(),
      onDoomLoop: vi.fn(),
      ...overrides,
    };
  }

  const messages = [
    {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "how do we build?" }],
    },
  ] as unknown as UIMessage[];

  it("injects an env block into the last user message and passes recalled memory", async () => {
    mockReadFile.mockResolvedValue({
      kind: "text",
      content: "# YAMET\n- use pnpm\n- commit often",
      size: 0,
    });
    mockRunAgentStream.mockResolvedValue({ toUIMessageStream: vi.fn() } as never);

    const transport = createContextAwareTransport(makeDeps());
    await transport.sendMessages({ messages });

    expect(mockRunAgentStream).toHaveBeenCalledTimes(1);
    const args = mockRunAgentStream.mock.calls[0][0] as {
      projectMemory: string | null;
      uiMessages: UIMessage[];
    };
    const last = args.uiMessages[args.uiMessages.length - 1];
    const lastText = last.parts.find(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    expect(lastText?.text).toContain("<env>");
    expect(lastText?.text).toContain("workspace_root: /ws1");
    expect(lastText?.text).toContain("active_terminal_mode: private");
    expect(args.projectMemory).toContain(MEMORY_NOTE);
    expect(args.projectMemory).toContain("use pnpm");
  });

  it("recalls session memory entries alongside static YAMET.md", async () => {
    mockReadFile.mockResolvedValue({ kind: "text", content: "", size: 0 });
    vi.mocked(getSessionMemory).mockReturnValue([
      { content: "session note", id: "n1", createdAt: 0, source: "tool" as const },
    ]);
    mockRunAgentStream.mockResolvedValue({ toUIMessageStream: vi.fn() } as never);

    const transport = createContextAwareTransport(
      makeDeps({
        getLive: () => ({
          cwd: "/ws2/sub",
          terminalPrivate: false,
          workspaceRoot: "/ws2",
          activeFile: null,
        }),
      }),
    );
    await transport.sendMessages({ messages });

    const args = mockRunAgentStream.mock.calls[0][0] as { projectMemory: string };
    expect(args.projectMemory).toContain("session note");
  });

  it("skips memory and env when no workspace root and no memory exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    vi.mocked(getSessionMemory).mockReturnValue([]);
    mockRunAgentStream.mockResolvedValue({ toUIMessageStream: vi.fn() } as never);

    const transport = createContextAwareTransport(
      makeDeps({
        getLive: () => ({
          cwd: null,
          terminalPrivate: false,
          workspaceRoot: null,
          activeFile: null,
        }),
      }),
    );
    await transport.sendMessages({ messages });

    const args = mockRunAgentStream.mock.calls[0][0] as {
      projectMemory: string | null;
      uiMessages: UIMessage[];
    };
    expect(args.projectMemory).toBeNull();
    const last = args.uiMessages[args.uiMessages.length - 1];
    const lastText = last.parts.find(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    expect(lastText?.text).toBe("how do we build?");
  });
});


// biome-ignore-all lint/style/noNonNullAssertion: 测试断言数据必然存在
import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemoryStore } from "../store/memoryStore";
import type { ToolContext } from "./context";

const MEM_START = "<!-- YaMet-project-memory:start -->";
const MEM_END = "<!-- YaMet-project-memory:end -->";

const transportMock = vi.hoisted(() => ({
  appendProjectMemory: vi.fn(async () => ({
    ok: true as const,
    path: "/w/YaMet.md",
  })),
  updateProjectMemory: vi.fn(async () => ({
    ok: true as const,
    path: "/w/YaMet.md",
  })),
  removeProjectMemory: vi.fn(async () => ({
    ok: true as const,
    path: "/w/YaMet.md",
  })),
  parseBlock: (content: string) => {
    const start = content.indexOf("<!-- YaMet-project-memory:start -->");
    const end = content.indexOf("<!-- YaMet-project-memory:end -->");
    if (start === -1 || end === -1 || end <= start) {
      return { prefix: content, lines: [], suffix: "" };
    }
    return {
      prefix: content.slice(0, start),
      lines: content
        .slice(start + "<!-- YaMet-project-memory:start -->".length, end)
        .split("\n")
        .filter((l) => l.trim().length > 0),
      suffix: content.slice(end + "<!-- YaMet-project-memory:end -->".length),
    };
  },
}));

vi.mock("../lib/transport", () => transportMock);

const nativeMock = vi.hoisted(() => ({
  readFile: vi.fn(async () => ({
    kind: "text" as const,
    content: "",
    size: 0,
  })),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

import { buildMemoryTools } from "./memory";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    executeInActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
    ...overrides,
  } as unknown as ToolContext;
}

type MemoryResult = {
  ok?: boolean;
  error?: string;
  id?: string;
  sessionOnly?: boolean;
  persisted?: boolean;
};

async function runMemory(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<MemoryResult> {
  const execute = buildMemoryTools(ctx).update_project_memory.execute;
  if (!execute) throw new Error("update_project_memory has no execute");
  return (await execute(
    input as never,
    toolOptions,
  )) as unknown as MemoryResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  useMemoryStore.getState().clearSession("session");
});

describe("update_project_memory", () => {
  it("writes to the in-session store and persists to YaMet.md", async () => {
    const result = await runMemory(makeContext(), {
      entry: "We use pnpm, never npm.",
    });
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);

    // In-session store holds the entry for the current session.
    const sessionMem = useMemoryStore.getState().bySession.session ?? [];
    expect(sessionMem).toHaveLength(1);
    expect(sessionMem[0].content).toBe("We use pnpm, never npm.");
    // Disk write happened once (append path, no id given).
    expect(transportMock.appendProjectMemory).toHaveBeenCalledTimes(1);
    expect(transportMock.updateProjectMemory).not.toHaveBeenCalled();
  });

  it("replaces an existing entry when an id is passed", async () => {
    // First call appends (no id), recording the id returned.
    const first = await runMemory(makeContext(), { entry: "fact one" });
    expect(first.id).toBeTruthy();
    const id = first.id!;
    // Second call with the same id replaces the entry.
    const second = await runMemory(makeContext(), {
      entry: "fact two",
      id,
    });
    expect(second.id).toBe(id);

    const sessionMem = useMemoryStore.getState().bySession.session ?? [];
    expect(sessionMem).toHaveLength(1);
    expect(sessionMem[0].content).toBe("fact two");
    // Append on the first (no id), update on the second (with id).
    expect(transportMock.appendProjectMemory).toHaveBeenCalledTimes(1);
    expect(transportMock.updateProjectMemory).toHaveBeenCalledTimes(1);
  });

  it("trims the entry and rejects empty input", async () => {
    const empty = await runMemory(makeContext(), { entry: "   " });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain("empty");
    expect(transportMock.appendProjectMemory).not.toHaveBeenCalled();
    expect(useMemoryStore.getState().bySession.session ?? []).toHaveLength(
      0,
    );
  });

  it("still writes session memory when there is no workspace root", async () => {
    const result = await runMemory(
      makeContext({ getWorkspaceRoot: () => null }),
      { entry: "session-only note" },
    );
    expect(result.ok).toBe(true);
    expect(result.sessionOnly).toBe(true);
    expect(result.persisted).toBe(false);
    expect(transportMock.appendProjectMemory).not.toHaveBeenCalled();
    const sessionMem = useMemoryStore.getState().bySession.session ?? [];
    expect(sessionMem).toHaveLength(1);
  });

  it("skips session-store write when there is no active session", async () => {
    const result = await runMemory(makeContext({ getSessionId: () => null }), {
      entry: "orphan",
    });
    expect(result.ok).toBe(true);
    // Persisted to disk even without a session.
    expect(transportMock.appendProjectMemory).toHaveBeenCalledTimes(1);
    // No session key in the store.
    expect(Object.keys(useMemoryStore.getState().bySession)).toHaveLength(0);
  });
});

describe("update_project_memory source", () => {
  it("marks auto-settled entries 'auto' and defaults to 'tool'", async () => {
    await runMemory(makeContext(), { entry: "settled fact", source: "auto" });
    const autoEntry = useMemoryStore.getState().bySession.session?.[0];
    expect(autoEntry?.source).toBe("auto");

    useMemoryStore.getState().clearSession("session");
    await runMemory(makeContext(), { entry: "agent fact" });
    const toolEntry = useMemoryStore.getState().bySession.session?.[0];
    expect(toolEntry?.source).toBe("tool");
  });
});

describe("list_project_memory", () => {
  it("merges session entries with persisted YaMet.md entries", async () => {
    await runMemory(makeContext(), { entry: "session fact" });
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: `# Y\n${MEM_START}\n- persisted fact\n${MEM_END}\n`,
      size: 0,
    });
    const execute = buildMemoryTools(makeContext()).list_project_memory.execute;
    const res = (await execute?.({} as never, toolOptions)) as {
      entries: Array<{ id: string; content: string; source: string }>;
    };
    expect(res.entries.length).toBe(2);
    expect(res.entries.some((e) => e.content === "session fact")).toBe(true);
    expect(res.entries.some((e) => e.id.startsWith("file:"))).toBe(true);
  });
});

describe("delete_project_memory", () => {
  it("deletes a persisted file entry via removeProjectMemory", async () => {
    const execute = buildMemoryTools(makeContext()).delete_project_memory.execute;
    const res = (await execute?.(
      { id: "file:persisted fact" } as never,
      toolOptions,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(transportMock.removeProjectMemory).toHaveBeenCalledWith(
      "/workspace",
      "persisted fact",
    );
  });

  it("removes a session entry from the store and the persisted copy", async () => {
    const created = await runMemory(makeContext(), { entry: "session fact" });
    const execute = buildMemoryTools(makeContext()).delete_project_memory.execute;
    const res = (await execute?.(
      { id: created.id } as never,
      toolOptions,
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(useMemoryStore.getState().bySession.session ?? []).toHaveLength(0);
    expect(transportMock.removeProjectMemory).toHaveBeenCalledWith(
      "/workspace",
      "session fact",
    );
  });
});

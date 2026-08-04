import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemoryStore } from "../store/memoryStore";
import type { ToolContext } from "./context";

const transportMock = vi.hoisted(() => ({
  appendProjectMemory: vi.fn(async () => ({
    ok: true as const,
    path: "/w/YAMET.md",
  })),
  updateProjectMemory: vi.fn(async () => ({
    ok: true as const,
    path: "/w/YAMET.md",
  })),
}));

vi.mock("../lib/transport", () => transportMock);

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
  it("writes to the in-session store and persists to YAMET.md", async () => {
    const result = await runMemory(makeContext(), {
      entry: "We use pnpm, never npm.",
    });
    expect(result.ok).toBe(true);
    expect(result.persisted).toBe(true);

    // In-session store holds the entry for the current session.
    const sessionMem = useMemoryStore.getState().bySession["session"] ?? [];
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

    const sessionMem = useMemoryStore.getState().bySession["session"] ?? [];
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
    expect(useMemoryStore.getState().bySession["session"] ?? []).toHaveLength(
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
    const sessionMem = useMemoryStore.getState().bySession["session"] ?? [];
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

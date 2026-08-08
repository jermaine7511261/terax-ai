// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

// agent.ts imports the managed-agents zustand store and writeToSession from the
// terminal module (which pulls in heavy xterm/pty code). Mock both so the tool
// loads cleanly under vitest/node and behavior is asserted against spies.
const agentStore = vi.hoisted(() => ({
  getBySessionId: vi.fn(),
  remove: vi.fn(),
  bumpRound: vi.fn(),
  get: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/modules/agents/store/managedAgentsStore", () => ({
  useManagedAgentsStore: { getState: () => agentStore },
}));

const terminalMock = vi.hoisted(() => ({
  writeToSession: vi.fn(() => true),
}));

vi.mock("@/modules/terminal", () => ({
  writeToSession: terminalMock.writeToSession,
}));

import { buildManagedAgentTools } from "./agent";

const managed = {
  leafId: 11,
  tabId: 5,
  sessionId: "sess",
  task: "fix bug",
  cwd: "/workspace",
  rounds: 2,
  maxRounds: 3,
  phase: "working",
  reviewedAtRound: -1,
  pendingReview: false,
};

function makeContext(
  overrides: Partial<ToolContext> = {},
  getSessionId: () => string | null = () => "sess",
): ToolContext {
  return {
    getSessionId,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    ...overrides,
  } as unknown as ToolContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  agentStore.getBySessionId.mockReturnValue(undefined);
  agentStore.remove.mockImplementation(() => {});
  agentStore.bumpRound.mockImplementation(() => {});
  agentStore.get.mockReturnValue(managed);
  terminalMock.writeToSession.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildManagedAgentTools tool definitions", () => {
  it("exposes all three agent tools", () => {
    const tools = buildManagedAgentTools({} as ToolContext);
    expect(tools).toHaveProperty("spawn_coding_agent");
    expect(tools).toHaveProperty("send_to_agent");
    expect(tools).toHaveProperty("read_agent_output");
  });

  it("documents that spawn and send require approval", () => {
    const tools = buildManagedAgentTools({} as ToolContext);
    expect(tools.spawn_coding_agent.needsApproval).toBe(true);
    expect(tools.send_to_agent.needsApproval).toBe(true);
  });
});

describe("input schema validation", () => {
  it("accepts a non-empty prompt for spawn_coding_agent", () => {
    const ok =
      buildManagedAgentTools({} as ToolContext).spawn_coding_agent.inputSchema.safeParse(
        { prompt: "delegate this" },
      );
    expect(ok.success).toBe(true);
  });

  it("rejects an empty prompt for spawn_coding_agent", () => {
    const r =
      buildManagedAgentTools({} as ToolContext).spawn_coding_agent.inputSchema.safeParse(
        { prompt: "" },
      );
    expect(r.success).toBe(false);
  });

  it("accepts a non-empty instruction for send_to_agent", () => {
    const ok =
      buildManagedAgentTools({} as ToolContext).send_to_agent.inputSchema.safeParse({
        instruction: "fix the typo",
      });
    expect(ok.success).toBe(true);
  });

  it("rejects an empty instruction for send_to_agent", () => {
    const r =
      buildManagedAgentTools({} as ToolContext).send_to_agent.inputSchema.safeParse({
        instruction: "",
      });
    expect(r.success).toBe(false);
  });

  it("accepts an optional lines count within range for read_agent_output", () => {
    const schema =
      buildManagedAgentTools({} as ToolContext).read_agent_output.inputSchema;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ lines: 5 }).success).toBe(true);
    expect(schema.safeParse({ lines: 400 }).success).toBe(true);
  });

  it("rejects an out-of-range or fractional lines count", () => {
    const schema =
      buildManagedAgentTools({} as ToolContext).read_agent_output.inputSchema;
    expect(schema.safeParse({ lines: 0 }).success).toBe(false);
    expect(schema.safeParse({ lines: 401 }).success).toBe(false);
    expect(schema.safeParse({ lines: 1.5 }).success).toBe(false);
  });
});

describe("spawn_coding_agent execute", () => {
  it("returns an error when there is no active session", async () => {
    const tool = buildManagedAgentTools(makeContext({}, () => null))
      .spawn_coding_agent;
    const result = await tool.execute({ prompt: "do it" });
    expect(result).toEqual({ error: "no active chat session" });
    expect(agentStore.getBySessionId).not.toHaveBeenCalled();
  });

  it("refuses to spawn when an agent is already active in the session", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).spawn_coding_agent;
    const result = await tool.execute({ prompt: "do it" });
    expect(result.error).toMatch(/already active/);
    expect(result.error).toMatch(/send_to_agent/);
  });

  it("returns an error when ctx.spawnAgent returns null", async () => {
    const tool = buildManagedAgentTools(
      makeContext({ spawnAgent: () => null }),
    ).spawn_coding_agent;
    const result = await tool.execute({ prompt: "do it" });
    expect(result).toEqual({ error: "could not spawn the agent" });
  });

  it("spawns the agent and returns the tab id", async () => {
    const tool = buildManagedAgentTools(
      makeContext({ spawnAgent: () => ({ tabId: 5, leafId: 11 }) }),
    ).spawn_coding_agent;
    const result = await tool.execute({ prompt: "do it" });
    expect(result).toEqual({
      ok: true,
      tab_id: 5,
      message: "Claude Code agent spawned. It will start working shortly.",
    });
  });
});

describe("send_to_agent execute", () => {
  it("returns an error when no agent is active in the session", async () => {
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    const result = await tool.execute({ instruction: "go on" });
    expect(result.error).toMatch(/no Claude Code agent is active/);
    expect(result.error).toMatch(/spawn_coding_agent/);
  });

  it("returns an error for an instruction that collapses to empty", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    const result = await tool.execute({ instruction: "   \n \t " });
    expect(result).toEqual({ error: "empty instruction" });
    expect(terminalMock.writeToSession).not.toHaveBeenCalled();
  });

  it("returns an error for instructions containing control characters", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    const result = await tool.execute({ instruction: "tab\there" });
    expect(result).toEqual({
      error: "instruction contains control characters",
    });
    expect(terminalMock.writeToSession).not.toHaveBeenCalled();
  });

  it("collapses newlines into a single line before sending", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    const result = await tool.execute({
      instruction: "line one\n   line two\r\nline three",
    });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe("line one line two line three");
    expect(terminalMock.writeToSession).toHaveBeenCalledWith(
      managed.leafId,
      "line one line two line three",
    );
  });

  it("removes the agent and returns an error when the terminal is gone", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    terminalMock.writeToSession.mockReturnValue(false);
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    const result = await tool.execute({ instruction: "go on" });
    expect(result).toEqual({
      error: "agent terminal is no longer available (closed?)",
    });
    expect(agentStore.remove).toHaveBeenCalledWith(managed.leafId);
  });

  it("sends the line, bumps the round, and reports the new round", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    agentStore.get.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    const result = await tool.execute({ instruction: "go on" });
    expect(result).toEqual({ ok: true, sent: "go on", round: 2 });
    expect(agentStore.bumpRound).toHaveBeenCalledWith(managed.leafId);
    expect(agentStore.get).toHaveBeenCalledWith(managed.leafId);
  });

  it("submits with a trailing Enter after a short delay", async () => {
    vi.useFakeTimers();
    agentStore.getBySessionId.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).send_to_agent;
    await tool.execute({ instruction: "go on" });
    expect(terminalMock.writeToSession).toHaveBeenCalledWith(
      managed.leafId,
      "go on",
    );
    vi.advanceTimersByTime(90);
    expect(terminalMock.writeToSession).toHaveBeenLastCalledWith(
      managed.leafId,
      "\r",
    );
  });
});

describe("read_agent_output execute", () => {
  it("reports active:false when no agent is bound to the session", async () => {
    const tool = buildManagedAgentTools(makeContext()).read_agent_output;
    const result = await tool.execute({});
    expect(result).toEqual({ active: false });
  });

  it("returns phase, rounds, and the tail of the terminal output", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    const raw = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const tool = buildManagedAgentTools(
      makeContext({ readAgentOutput: () => raw }),
    ).read_agent_output;
    const result = await tool.execute({ lines: 5 });
    expect(result).toMatchObject({
      active: true,
      phase: "working",
      rounds: 2,
      max_rounds: 3,
    });
    expect(result.output).toBe(
      ["line 195", "line 196", "line 197", "line 198", "line 199"].join("\n"),
    );
  });

  it("returns an empty output string when readAgentOutput returns null", async () => {
    agentStore.getBySessionId.mockReturnValue(managed);
    const tool = buildManagedAgentTools(makeContext()).read_agent_output;
    const result = await tool.execute({});
    expect(result.active).toBe(true);
    expect(result.output).toBe("");
  });
});

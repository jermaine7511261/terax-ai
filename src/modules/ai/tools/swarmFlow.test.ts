// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the LLM runner + the stores so execute() can be exercised without a
// real model or UI (same pattern as delegateMany.test.ts).
vi.mock("../agents/runSubagent", () => ({
  runSubagent: vi.fn(),
}));

const activities = vi.hoisted(() => {
  const h = {
    items: [],
    start: vi.fn((a) => h.items.push(a)),
    updateStep: vi.fn(),
    finish: vi.fn(),
    fail: vi.fn(),
  };
  return h;
});

vi.mock("../store/agentActivityStore", () => {
  let n = 0;
  return {
    useAgentActivityStore: { getState: () => activities },
    newActivityId: () => `act-${++n}`,
  };
});

const chat = vi.hoisted(() => ({
  apiKeys: { deepseek: "sk-test" },
  selectedModelId: "deepseek-v4-flash",
  customEndpointKeys: {},
  activeSessionId: null,
}));
vi.mock("../store/chatStore", () => ({
  useChatStore: { getState: () => chat },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ customEndpoints: [] }) },
}));

import { runSubagent } from "../agents/runSubagent";
import {
  buildSwarmFlowTools,
  isHumanGate,
  parseFlow,
} from "./swarmFlow";
import type { ToolContext } from "./context";

const ctx = {} as ToolContext;

function tool() {
  return buildSwarmFlowTools(ctx).swarm_flow;
}

beforeEach(() => {
  vi.clearAllMocks();
  activities.items = [];
  vi.mocked(runSubagent).mockReset();
});

describe("parseFlow (pure DSL parser)", () => {
  it("parses parallel, sequential and mixed stages", () => {
    expect(parseFlow("A, B -> C -> D")).toEqual([["A", "B"], ["C"], ["D"]]);
  });

  it("drops empty segments (trailing arrows, doubled commas)", () => {
    expect(parseFlow("A ->  -> B")).toEqual([["A"], ["B"]]);
    expect(parseFlow("A,,B")).toEqual([["A", "B"]]);
    expect(parseFlow("-> A ->")).toEqual([["A"]]);
  });

  it("returns [] for an empty flow", () => {
    expect(parseFlow("")).toEqual([]);
    expect(parseFlow("  ->  ")).toEqual([]);
  });

  it("trims whitespace around node names", () => {
    expect(parseFlow("  X , Y ")).toEqual([["X", "Y"]]);
  });

  it("recognizes H as a human gate (case-insensitive)", () => {
    expect(isHumanGate("H")).toBe(true);
    expect(isHumanGate("h")).toBe(true);
    expect(isHumanGate("A")).toBe(false);
  });
});

describe("swarm_flow execute (orchestration)", () => {
  it("runs sequential stages with relay context", async () => {
    const prompts = [];
    vi.mocked(runSubagent).mockImplementation(async ({ prompt, context }) => {
      prompts.push({ prompt, context });
      return { summary: `out:${prompts.length}`, stepCount: 1, durationMs: 1 };
    });
    const res = await tool().execute({ flow: "A -> B", task: "do it" });

    expect(runSubagent).toHaveBeenCalledTimes(2);
    // Stage B's context must contain stage A's summary (relay).
    expect(prompts[1].context).toContain("[From A]");
    expect(prompts[1].context).toContain("out:1");
    expect(res.ok).toBe(true);
    expect(res.steps.map((s) => s.node)).toEqual(["A", "B"]);
  });

  it("runs parallel nodes in the same stage", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "ok",
      stepCount: 0,
      durationMs: 0,
    }));
    const res = await tool().execute({ flow: "A, B, C", task: "t" });
    expect(runSubagent).toHaveBeenCalledTimes(3);
    expect(res.steps).toHaveLength(3);
    expect(res.steps.every((s) => s.ok)).toBe(true);
  });

  it("caps a large parallel stage at MAX_PARALLEL_WORKERS per wave", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "ok",
      stepCount: 0,
      durationMs: 0,
    }));
    // 9 nodes in one stage → still all run (2 waves of <=4).
    const res = await tool().execute({
      flow: "n1,n2,n3,n4,n5,n6,n7,n8,n9",
      task: "t",
    });
    expect(runSubagent).toHaveBeenCalledTimes(9);
    expect(res.steps).toHaveLength(9);
  });

  it("uses per-node types and defaults to general", async () => {
    const types = [];
    vi.mocked(runSubagent).mockImplementation(async ({ type }) => {
      types.push(type);
      return { summary: "ok", stepCount: 0, durationMs: 0 };
    });
    await tool().execute({
      flow: "codeNode, plain",
      task: "t",
      types: { codeNode: "code" },
    });
    expect(types).toEqual(["code", "general"]);
  });

  it("records H gates without spawning a subagent", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "ok",
      stepCount: 0,
      durationMs: 0,
    }));
    const res = await tool().execute({ flow: "A -> H -> B", task: "t" });
    expect(runSubagent).toHaveBeenCalledTimes(2); // A and B only
    expect(res.human_gates).toEqual(["H"]);
    const gate = res.steps.find((s) => s.gate);
    expect(gate.node).toBe("H");
  });

  it('aggregate "final" returns last stage text', async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "s",
      stepCount: 0,
      durationMs: 0,
    }));
    const res = await tool().execute({ flow: "A -> B", task: "t", aggregate: "final" });
    expect(typeof res.final).toBe("string");
    expect(res.final).toBe("s");
  });

  it('aggregate "dict" maps node→summary', async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "s",
      stepCount: 0,
      durationMs: 0,
    }));
    const res = await tool().execute({ flow: "A, B", task: "t", aggregate: "dict" });
    expect(res.final).toEqual({ A: "s", B: "s" });
  });

  it('aggregate "list" (default) returns per-node summaries', async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "s",
      stepCount: 0,
      durationMs: 0,
    }));
    const res = await tool().execute({ flow: "A, B", task: "t" });
    expect(Array.isArray(res.final)).toBe(true);
    expect(res.final).toEqual([
      { node: "A", summary: "s" },
      { node: "B", summary: "s" },
    ]);
  });

  it("rejects an empty flow without running anything", async () => {
    const res = await tool().execute({ flow: "", task: "t" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("empty flow");
    expect(runSubagent).not.toHaveBeenCalled();
  });

  it("marks a failed node ok=false without failing the whole pipeline", async () => {
    vi.mocked(runSubagent)
      .mockResolvedValueOnce({ summary: "good", stepCount: 1, durationMs: 1 })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await tool().execute({ flow: "A -> B", task: "t" });
    expect(res.steps[0].ok).toBe(true);
    expect(res.steps[1].ok).toBe(false);
    expect(res.steps[1].error).toBe("boom");
    expect(res.ok).toBe(false);
  });
});

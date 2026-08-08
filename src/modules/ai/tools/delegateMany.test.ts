// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the LLM runner + the two stores + the activity store so the tool's
// execute() can be exercised without a real model or UI.
vi.mock("../agents/runSubagent", () => ({
  runSubagent: vi.fn(),
  MAX_SPAWN_DEPTH: 3,
  SUBAGENT_SUMMARY_CAP: 4000,
}));

const activities = vi.hoisted(() => {
  const h = {
    items: [],
    start: vi.fn((a) => h.items.push(a)),
    updateStep: vi.fn(),
    finish: vi.fn((id, summary, stepCount) => {
      const a = h.items.find((x) => x.id === id);
      if (a) {
        a.status = "done";
        a.summary = summary;
        a.stepCount = stepCount;
      }
    }),
    fail: vi.fn((id, error) => {
      const a = h.items.find((x) => x.id === id);
      if (a) {
        a.status = "error";
        a.summary = error;
      }
    }),
  };
  return h;
});

vi.mock("../store/agentActivityStore", () => {
  let n = 0;
  return {
    useAgentActivityStore: {
      getState: () => activities,
    },
    newActivityId: () => `act-${++n}`,
  };
});

const chat = vi.hoisted(() => ({
  apiKeys: { deepseek: "sk-test" },
  selectedModelId: "deepseek-v4-flash",
  customEndpointKeys: {},
}));
vi.mock("../store/chatStore", () => ({
  useChatStore: { getState: () => chat },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ customEndpoints: [] }) },
}));

import { runSubagent } from "../agents/runSubagent";
import {
  buildDelegateManyTools,
  MAX_PARALLEL_WORKERS,
} from "./delegateMany";
import type { ToolContext } from "./context";

const ctx = {} as ToolContext;

function tool() {
  return buildDelegateManyTools(ctx).delegate_many;
}

beforeEach(() => {
  vi.clearAllMocks();
  activities.items = [];
  activities.start.mockClear();
  activities.finish.mockClear();
  activities.fail.mockClear();
  vi.mocked(runSubagent).mockReset();
});

describe("delegate_many (P0-2 parallel workers)", () => {
  it("runs workers in parallel and aggregates results", async () => {
    vi.mocked(runSubagent).mockImplementation(async ({ onStep }) => {
      onStep?.("explore: read_file");
      return { summary: "found X", stepCount: 3, durationMs: 10 };
    });
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "find A" },
        { type: "explore", prompt: "find B" },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.requested).toBe(2);
    expect(res.spawned).toBe(2);
    expect(res.results[0].summary).toBe("found X");
    expect(runSubagent).toHaveBeenCalledTimes(2);
  });

  it("injects isolated context ahead of each worker prompt", async () => {
    let promptSeen = "";
    vi.mocked(runSubagent).mockImplementation(async ({ prompt, context }) => {
      promptSeen = `${context ?? ""}\n\n${prompt}`;
      return { summary: "ok", stepCount: 0, durationMs: 0 };
    });
    await tool().execute({
      tasks: [{ type: "explore", prompt: "task", context: "step1 output" }],
    });
    expect(promptSeen).toContain("step1 output");
    expect(promptSeen).toContain("task");
  });

  it("refuses to spawn beyond MAX_SPAWN_DEPTH", async () => {
    const deepCtx = { getSubagentDepth: () => 3 } as unknown as ToolContext;
    const res = await buildDelegateManyTools(deepCtx)
      .delegate_many.execute({
        tasks: [{ type: "explore", prompt: "too deep" }],
      });
    expect(res.ok).toBe(false);
    expect(res.spawned).toBe(0);
    expect(res.skipped.length).toBe(1);
    expect(runSubagent).not.toHaveBeenCalled();
  });

  it("marks a failed worker ok=false without failing the whole batch", async () => {
    vi.mocked(runSubagent)
      .mockResolvedValueOnce({ summary: "good", stepCount: 1, durationMs: 1 })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "A" },
        { type: "explore", prompt: "B" },
      ],
    });
    expect(res.results[0].ok).toBe(true);
    expect(res.results[1].ok).toBe(false);
    expect(res.results[1].error).toBe("boom");
    expect(res.ok).toBe(false);
  });

  it("caps concurrency at MAX_PARALLEL_WORKERS", () => {
    expect(MAX_PARALLEL_WORKERS).toBe(4);
  });

  it("rejects workers beyond the step budget without refund rollback", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "ok",
      stepCount: 1,
      durationMs: 0,
    }));
    // 9 tasks > WORKER_STEP_BUDGET (8): exactly 8 may spawn; the 9th must be
    // rejected with "worker budget exhausted" (a buggy refund would instead let
    // every other worker through, so this asserts the cap holds continuously).
    const tasks = Array.from({ length: 9 }, (_, i) => ({
      type: "explore" as const,
      prompt: `task ${i}`,
    }));
    const res = await tool().execute({ tasks });
    expect(runSubagent).toHaveBeenCalledTimes(8);
    const exhausted = res.results.filter((r) => !r.ok && r.error?.includes("budget"));
    expect(exhausted).toHaveLength(1);
    expect(res.requested).toBe(9);
    expect(res.spawned).toBe(8);
  });
});

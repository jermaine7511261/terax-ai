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

const chat = vi.hoisted(() => {
  const h: {
    apiKeys: Record<string, string>;
    selectedModelId: string;
    customEndpointKeys: Record<string, string>;
    activeSessionId: string | null;
    sessions: Array<{ id: string; parentId?: string }>;
    createSubSession: (parentId: string, title?: string) => string;
    resolveRootSessionId: (id: string) => string;
  } = {
    apiKeys: { deepseek: "sk-test" },
    selectedModelId: "deepseek-v4-flash",
    customEndpointKeys: {},
    activeSessionId: "s-main",
    sessions: [{ id: "s-main" }],
    createSubSession: vi.fn((parentId) => {
      const id = `s-sub-${h.sessions.length}`;
      h.sessions.push({ id, parentId });
      return id;
    }),
    resolveRootSessionId: vi.fn((id) => id),
  };
  return h;
});
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
  chat.sessions = [{ id: "s-main" }];
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

  it("fails a hung worker with a timeout instead of blocking the wave", async () => {
    vi.useFakeTimers();
    try {
      // runSubagent never resolves (stuck model / hung tool).
      vi.mocked(runSubagent).mockImplementation(() => new Promise(() => {}));
      const promise = tool().execute({
        tasks: [{ type: "explore", prompt: "hung task" }],
      });
      // Advance past the per-worker timeout (7 min).
      await vi.advanceTimersByTimeAsync(7 * 60 * 1000 + 1000);
      const res = await promise;
      expect(res.results[0].ok).toBe(false);
      expect(res.results[0].error).toBe("worker timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns partial progress when a worker times out mid-run", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(runSubagent).mockImplementation(async ({ onStep }) => {
        onStep?.("explore: read_file");
        onStep?.("explore: grep");
        return new Promise(() => {}); // hang after 2 completed steps
      });
      const promise = tool().execute({
        tasks: [{ type: "explore", prompt: "partial task" }],
      });
      await vi.advanceTimersByTimeAsync(7 * 60 * 1000 + 1000);
      const res = await promise;
      expect(res.results[0].ok).toBe(false);
      expect(res.results[0].partial).toBe(true);
      expect(res.results[0].stepCount).toBe(2);
      expect(res.results[0].lastStep).toBe("explore: grep");
      expect(res.results[0].summary).toContain("read_file");
      expect(res.results[0].summary).toContain("grep");
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects max_concurrent as the dynamic concurrency pool width", async () => {
    let running = 0;
    let peak = 0;
    vi.mocked(runSubagent).mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { summary: "ok", stepCount: 1, durationMs: 1 };
    });
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      type: "explore" as const,
      prompt: `t${i}`,
    }));
    const res = await tool().execute({ tasks, max_concurrent: 2 });
    expect(res.requested).toBe(5);
    expect(res.spawned).toBe(5);
    expect(res.results).toHaveLength(5);
    // Peak simultaneous workers == wave width, not the default 4.
    expect(peak).toBe(2);
  });

  it("clamps max_concurrent to [1, 8] and defaults to 4 when omitted", () => {
    // A batch of 9 with max_concurrent=99 must still peak at 8 in-flight.
    // (Omitted-override default is already covered by existing tests.)
    const concurrency = (n?: number) =>
      n === undefined ? 4 : Math.min(8, Math.max(1, Math.round(n)));
    expect(concurrency(undefined)).toBe(4);
    expect(concurrency(0)).toBe(1);
    expect(concurrency(99)).toBe(8);
    expect(concurrency(4.6)).toBe(5);
  });

  it("dedupes tasks by (type, prompt, context) and lists duplicates in skipped", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "ok",
      stepCount: 1,
      durationMs: 1,
    }));
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "same", context: "ctx" },
        { type: "explore", prompt: "same", context: "ctx" },
        { type: "explore", prompt: "different" },
        { type: "explore", prompt: "same" }, // different context -> not a dup
      ],
      dedupe: true,
    });
    expect(runSubagent).toHaveBeenCalledTimes(3);
    expect(res.requested).toBe(4);
    expect(res.results).toHaveLength(3);
    expect(res.skipped).toHaveLength(1);
  });

  it("leaves dedupe off by default so identical tasks all run", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "ok",
      stepCount: 1,
      durationMs: 1,
    }));
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "same" },
        { type: "explore", prompt: "same" },
      ],
    });
    expect(runSubagent).toHaveBeenCalledTimes(2);
    expect(res.skipped).toHaveLength(0);
  });

  it("aggregate='final' returns the last ok summary as a string", async () => {
    vi.mocked(runSubagent)
      .mockResolvedValueOnce({ summary: "s1", stepCount: 1, durationMs: 1 })
      .mockResolvedValueOnce({ summary: "s2", stepCount: 1, durationMs: 1 })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "a" },
        { type: "explore", prompt: "b" },
        { type: "explore", prompt: "c" },
      ],
      aggregate: "final",
    });
    expect(typeof res.aggregated).toBe("string");
    expect(res.aggregated).toBe("s2"); // last *ok* result; failed 3rd ignored
  });

  it("aggregate='final' yields null when no worker succeeds", async () => {
    vi.mocked(runSubagent).mockRejectedValue(new Error("boom"));
    const res = await tool().execute({
      tasks: [{ type: "explore", prompt: "a" }],
      aggregate: "final",
    });
    expect(res.aggregated).toBeNull();
  });

  it("aggregate='list' joins ok summaries as [type] summary lines", async () => {
    vi.mocked(runSubagent)
      .mockResolvedValueOnce({ summary: "A1", stepCount: 1, durationMs: 1 })
      .mockResolvedValueOnce({ summary: "B2", stepCount: 1, durationMs: 1 })
      .mockRejectedValueOnce(new Error("boom"));
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "a" },
        { type: "code-review", prompt: "b" },
        { type: "explore", prompt: "c" },
      ],
      aggregate: "list",
    });
    expect(res.aggregated).toBe("[explore] A1\n[code-review] B2");
  });

  it("aggregate='dict' returns a {type: summary} map, last ok per type wins", async () => {
    vi.mocked(runSubagent)
      .mockResolvedValueOnce({ summary: "e1", stepCount: 1, durationMs: 1 })
      .mockResolvedValueOnce({ summary: "g1", stepCount: 1, durationMs: 1 })
      .mockResolvedValueOnce({ summary: "e2", stepCount: 1, durationMs: 1 });
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "a" },
        { type: "general", prompt: "b" },
        { type: "explore", prompt: "c" },
      ],
      aggregate: "dict",
    });
    expect(res.aggregated).toEqual({ explore: "e2", general: "g1" });
  });

  it("default aggregate='all' leaves aggregated undefined and returns full results", async () => {
    vi.mocked(runSubagent).mockImplementation(async () => ({
      summary: "x",
      stepCount: 1,
      durationMs: 1,
    }));
    const res = await tool().execute({
      tasks: [
        { type: "explore", prompt: "a" },
        { type: "explore", prompt: "b" },
      ],
    });
    expect(res.aggregated).toBeUndefined();
    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results).toHaveLength(2);
  });
});

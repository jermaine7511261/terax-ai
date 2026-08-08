// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GraphEngine } from "./engine";
import type { GraphDef, GraphEvent, GraphNode } from "./types";

const journalData = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/platform", () => ({
  createStorage: () => ({
    set: vi.fn(async (_k: string, v: unknown) => {
      journalData.set(_k, v);
    }),
    get: vi.fn(async (k: string) => journalData.get(k) ?? null),
    delete: vi.fn(async (k: string) => {
      journalData.delete(k);
    }),
  }),
}));


beforeEach(() => {
  journalData.clear();
  vi.clearAllMocks();
});

type EngineDeps = {
  runAgent: ReturnType<typeof vi.fn>;
  judge: ReturnType<typeof vi.fn>;
  askHuman: ReturnType<typeof vi.fn>;
  emit: (ev: GraphEvent) => void;
  verify?: unknown;
  maxConcurrent?: number;
};

function makeDeps(over: Partial<EngineDeps> = {}) {
  const events: GraphEvent[] = [];
  return {
    runAgent: vi.fn(async () => ({ output: "agent-out", stepCount: 2 })),
    judge: vi.fn(async () => "target-2"),
    askHuman: vi.fn(async () => true),
    emit: (ev: GraphEvent) => events.push(ev),
    verify: undefined,
    maxConcurrent: 4,
    events,
    ...over,
  };
}

function linearGraph(): GraphDef {
  return {
    id: "g1",
    name: "linear",
    nodes: [
      { id: "n1", kind: "agent", name: "A", prompt: "do a" },
      { id: "n2", kind: "agent", name: "B", prompt: "do b" },
    ],
    edges: [
      { from: "n1", to: "n2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GraphEngine (P0-1, L4 + H6)", () => {
  it("runs a linear graph in dependency order and injects prior output", async () => {
    const d = makeDeps();
    const eng = new GraphEngine(d as never);
    const order: string[] = [];
    const outputs: Record<string, string> = {};
    d.runAgent.mockImplementation(async (node: GraphNode, ctx: string) => {
      order.push(node.id);
      // n2 must receive n1's output as context (P1-2).
      if (node.id === "n2") {
        expect(ctx).toContain("n1-out");
      }
      outputs[node.id] = `${node.id}-out`;
      return { output: outputs[node.id], stepCount: 1 };
    });
    await eng.run(linearGraph());
    expect(order).toEqual(["n1", "n2"]);
    expect(d.events.some((e) => e.type === "run-done")).toBe(true);
    expect(d.events.filter((e) => e.type === "node-done").length).toBe(2);
  });

  it("runs independent nodes in parallel within a wave", async () => {
    const d = makeDeps();
    d.maxConcurrent = 4;
    const eng = new GraphEngine(d as never);
    const active = { v: 0, peak: 0 };
    d.runAgent.mockImplementation(async () => {
      active.v++;
      active.peak = Math.max(active.peak, active.v);
      await new Promise((r) => setTimeout(r, 10));
      active.v--;
      return { output: "x", stepCount: 1 };
    });
    const def: GraphDef = {
      id: "g2",
      name: "parallel",
      nodes: [
        { id: "a", kind: "agent", prompt: "1" },
        { id: "b", kind: "agent", prompt: "2" },
        { id: "c", kind: "agent", prompt: "3" },
        { id: "merge", kind: "merge", name: "M" },
      ],
      edges: [
        { from: "a", to: "merge" },
        { from: "b", to: "merge" },
        { from: "c", to: "merge" },
      ],
    };
    await eng.run(def);
    // Three independent sources should have overlapped.
    expect(active.peak).toBeGreaterThanOrEqual(2);
    // Merge aggregates all three outputs.
    const mergeDone = d.events.find(
      (e) => e.type === "node-done" && e.nodeId === "merge",
    );
    expect(mergeDone?.output).toContain("x");
  });

  it("judge node follows only the chosen branch", async () => {
    const d = makeDeps();
    d.judge.mockResolvedValue("target-2");
    const eng = new GraphEngine(d as never);
    const executed: string[] = [];
    d.runAgent.mockImplementation(async (node: GraphNode) => {
      executed.push(node.id);
      return { output: "x", stepCount: 1 };
    });
    const def: GraphDef = {
      id: "g3",
      name: "branch",
      nodes: [
        { id: "judge", kind: "judge", name: "J", prompt: "pick", branches: {} },
        { id: "target-1", kind: "agent", prompt: "t1" },
        { id: "target-2", kind: "agent", prompt: "t2" },
      ],
      edges: [
        { from: "judge", to: "target-1" },
        { from: "judge", to: "target-2" },
      ],
    };
    await eng.run(def);
    // judge output = chosen target id; runAgent is only called for the chosen.
    expect(executed).toEqual(["target-2"]);
    expect(d.judge).toHaveBeenCalled();
  });

  it("human node waits for approval and continues on approve", async () => {
    const d = makeDeps();
    const eng = new GraphEngine(d as never);
    let resolveHuman: ((v: boolean) => void) | undefined;
    d.askHuman.mockImplementation(
      () => new Promise((r) => (resolveHuman = r)),
    );
    const def: GraphDef = {
      id: "g4",
      name: "human",
      nodes: [
        { id: "h", kind: "human", name: "H", prompt: "approve?" },
        { id: "after", kind: "agent", prompt: "continue" },
      ],
      edges: [{ from: "h", to: "after" }],
    };
    const p = eng.run(def);
    // Give the engine a tick to reach the human gate.
    await new Promise((r) => setTimeout(r, 10));
    expect(d.events.some((e) => e.type === "human-request")).toBe(true);
    // Emulate UI approval.
    resolveHuman?.(true);
    await p;
    expect(d.events.some((e) => e.type === "run-done")).toBe(true);
  });

  it("cancel() releases a pending human gate without marking it failed", async () => {
    const d = makeDeps();
    const eng = new GraphEngine(d as never);
    let resolveHuman: ((v: boolean) => void) | undefined;
    d.askHuman.mockImplementation(
      () => new Promise((r) => (resolveHuman = r)),
    );
    const def: GraphDef = {
      id: "g-cancel-human",
      name: "cancel-human",
      nodes: [{ id: "h", kind: "human", name: "H", prompt: "approve?" }],
      edges: [],
    };
    const p = eng.run(def);
    await new Promise((r) => setTimeout(r, 10));
    expect(d.events.some((e) => e.type === "human-request")).toBe(true);
    eng.cancel();
    // Store.cancel() resolves pending human gates with false; the engine must
    // unwind (run-cancelled) and NOT emit node-fail for the human node.
    resolveHuman?.(false);
    await p;
    expect(d.events.some((e) => e.type === "run-cancelled")).toBe(true);
    expect(d.events.some((e) => e.type === "node-fail")).toBe(false);
  });

  it("cancel() marks the run cancelled", async () => {
    const d = makeDeps();
    const eng = new GraphEngine(d as never);
    d.runAgent.mockImplementation(() => new Promise((r) => setTimeout(r, 50)));
    const def = linearGraph();
    const p = eng.run(def);
    setTimeout(() => eng.cancel(), 5);
    await p;
    expect(d.events.some((e) => e.type === "run-cancelled")).toBe(true);
  });

  it("resume reuses completed nodes from the journal", async () => {
    const d = makeDeps();
    const eng = new GraphEngine(d as never);
    const runCalls: string[] = [];
    d.runAgent.mockImplementation(async (node: GraphNode) => {
      runCalls.push(node.id);
      return { output: `${node.id}-out`, stepCount: 1 };
    });
    await eng.run(linearGraph());
    expect(runCalls).toEqual(["n1", "n2"]);
    // Second run with resume: both already done → skip re-execution.
    runCalls.length = 0;
    await eng.run(linearGraph(), { resume: true });
    expect(runCalls).toEqual([]); // completed nodes not re-run
    expect(d.events.some((e) => e.type === "run-done")).toBe(true);
  });
});

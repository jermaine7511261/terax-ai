// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

const journalData = vi.hoisted(() => new Map<string, unknown>());

const hooksMock = vi.hoisted(() => ({
  runAgent: vi.fn(async () => ({ output: "out", stepCount: 1 })),
  judge: vi.fn(async () => "x"),
  verify: async (_n: unknown, out: string) => ({ output: out, stepCount: 0 }),
}));

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

import { setGraphHooks, useGraphStore } from "./store";
import type { GraphDef } from "./types";

function agentGraph(over: Partial<GraphDef> = {}): GraphDef {
  return {
    id: "g1",
    name: "t",
    nodes: [{ id: "n1", kind: "agent", name: "A", prompt: "do a" }],
    edges: [],
    ...over,
  };
}

const humanNode = { id: "h1", kind: "human", name: "H", prompt: "ok?" };

beforeEach(() => {
  journalData.clear();
  hooksMock.runAgent.mockClear();
  hooksMock.judge.mockClear();
  useGraphStore.setState({ runs: {}, activeRunId: null, pendingHuman: null });
  setGraphHooks(hooksMock);
});

describe("useGraphStore", () => {
  it("runs an agent graph to completion and records node state", async () => {
    hooksMock.runAgent.mockResolvedValue({ output: "hello", stepCount: 2 });
    await useGraphStore.getState().run(agentGraph());
    expect(hooksMock.runAgent).toHaveBeenCalled();
    const run = useGraphStore.getState().runs.g1;
    expect(run.status).toBe("done");
    expect(run.nodes.n1).toMatchObject({ status: "done", output: "hello" });
    expect(useGraphStore.getState().activeRunId).toBe("g1");
  });

  it("keeps earlier runs when a second run starts", async () => {
    await useGraphStore.getState().run(agentGraph());
    await useGraphStore
      .getState()
      .run(agentGraph({ id: "g2", name: "t2", nodes: [{ id: "n1", kind: "agent", name: "A", prompt: "x" }] }));
    expect(Object.keys(useGraphStore.getState().runs).sort()).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("getStateOf returns the node state for a run", async () => {
    await useGraphStore.getState().run(agentGraph());
    expect(useGraphStore.getState().getStateOf("g1", "n1")?.status).toBe("done");
    expect(useGraphStore.getState().getStateOf("g1", "missing")).toBeUndefined();
  });

  it("surfaces a human node as pendingHuman and resolves it", async () => {
    const p = useGraphStore
      .getState()
      .run(agentGraph({ nodes: [humanNode] }));
    await vi.waitFor(() =>
      expect(useGraphStore.getState().pendingHuman).not.toBeNull(),
    );
    expect(useGraphStore.getState().pendingHuman).toMatchObject({
      nodeId: "h1",
      prompt: "ok?",
      scope: "g1",
    });
    useGraphStore.getState().resolveHuman("h1", "approve");
    await p;
    expect(useGraphStore.getState().pendingHuman).toBeNull();
    expect(useGraphStore.getState().runs.g1.status).toBe("done");
  });

  it("cancel releases a pending human gate", async () => {
    const p = useGraphStore
      .getState()
      .run(agentGraph({ nodes: [humanNode] }));
    await vi.waitFor(() =>
      expect(useGraphStore.getState().pendingHuman).not.toBeNull(),
    );
    useGraphStore.getState().cancel();
    await p;
    expect(useGraphStore.getState().pendingHuman).toBeNull();
    expect(["cancelled", "done", "failed"]).toContain(
      useGraphStore.getState().runs.g1.status,
    );
  });

  it("resolveHuman with reject fails the node path", async () => {
    const p = useGraphStore
      .getState()
      .run(agentGraph({ nodes: [humanNode] }));
    await vi.waitFor(() =>
      expect(useGraphStore.getState().pendingHuman).not.toBeNull(),
    );
    useGraphStore.getState().resolveHuman("h1", "reject", "no thanks");
    await p;
    expect(useGraphStore.getState().pendingHuman).toBeNull();
    expect(useGraphStore.getState().runs.g1.status).toBe("failed");
  });
});

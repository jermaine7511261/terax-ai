// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from "vitest";
import { GraphEngine } from "./engine";
import type { GraphDef, GraphEvent } from "./types";

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

function makeDeps() {
  const events: GraphEvent[] = [];
  return {
    runAgent: vi.fn(async () => ({ output: "agent-out", stepCount: 2 })),
    judge: vi.fn(async () => "chosen"),
    askHuman: vi.fn(async () => true),
    emit: (ev: GraphEvent) => events.push(ev),
  };
}

describe("judge branch downstream pruning", () => {
  it("must NOT execute nodes downstream of an unchosen branch", async () => {
    const d = makeDeps();
    d.judge.mockResolvedValue("chosen");
    const eng = new GraphEngine(d as never);
    const executed: string[] = [];
    d.runAgent.mockImplementation(async (node: { id: string }) => {
      executed.push(node.id);
      return { output: "x", stepCount: 1 };
    });
    const def: GraphDef = {
      id: "g-prune",
      name: "prune",
      nodes: [
        { id: "judge", kind: "judge", name: "J", prompt: "pick", branches: {} },
        { id: "chosen", kind: "agent", prompt: "t1" },
        { id: "unchosen", kind: "agent", prompt: "t2" },
        // downstream of the unchosen branch — must be skipped too
        { id: "unchosen-child", kind: "agent", prompt: "t3" },
      ],
      edges: [
        { from: "judge", to: "chosen" },
        { from: "judge", to: "unchosen" },
        { from: "unchosen", to: "unchosen-child" },
      ],
    };
    await eng.run(def);
    // Only the chosen branch and NOTHING downstream of unchosen should run.
    expect(executed).toEqual(["chosen"]);
  });
});

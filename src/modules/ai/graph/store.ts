import { create } from "zustand";
import { GraphEngine } from "./engine";
import {
  applyApproval,
  createApprovalMemory,
  resolveApproval,
  type ApprovalDecision,
  type ApprovalMemory,
} from "../lib/approval";
import type {
  GraphDef,
  GraphEvent,
  GraphNode,
  GraphRun,
  GraphRunState,
} from "./types";

/**
 * Graph run store (P0-1 frontend). Holds the live state of the most recent
 * graph run and drives a single shared GraphEngine wired to real subagent
 * execution + tool approval. The GraphRunPanel subscribes here; the `run_graph`
 * tool triggers `run()`.
 *
 * Human nodes surface a pending decision through `pendingHuman`; the panel
 * resolves it via `resolveHuman(nodeId, approved)` which feeds back through
 * the engine's `askHuman` dep.
 */

export type GraphEngineHooks = {
  runAgent: (
    node: GraphNode,
    context: string,
  ) => Promise<{ output?: string; stepCount?: number }>;
  judge: (node: GraphNode, context: string) => Promise<string>;
  verify?: (
    node: GraphNode,
    output: string,
  ) => Promise<{ output?: string; stepCount?: number }>;
};

/** Register the concrete subagent/judge runners (called once at bootstrap). */
let hooks: GraphEngineHooks | null = null;
export function setGraphHooks(h: GraphEngineHooks): void {
  hooks = h;
}

type GraphStore = {
  runs: Record<string, GraphRun>;
  activeRunId: string | null;
  pendingHuman: { nodeId: string; prompt: string; scope: string } | null;
  engine: GraphEngine;
  run: (def: GraphDef, opts?: { resume?: boolean }) => Promise<void>;
  resolveHuman: (
    nodeId: string,
    decision: ApprovalDecision,
    feedback?: string,
  ) => void;
  cancel: () => void;
  getStateOf: (runId: string, nodeId: string) => GraphRunState | undefined;
};

// Module-level resolver map so resolveHuman can release the engine's await.
const humanResolvers = new Map<string, (v: boolean) => void>();
// P1-3 tri-state approval memory (always/cascade) for graph human nodes.
const approvalMemory: ApprovalMemory = createApprovalMemory();

function buildEngine(emit: (ev: GraphEvent) => void): GraphEngine {
  return new GraphEngine({
    emit,
    runAgent: async (n, ctx) => hooks?.runAgent(n, ctx) ?? { output: "" },
    judge: async (n, ctx) => hooks?.judge(n, ctx) ?? "",
    askHuman: (node) => {
      // P1-3 cascade: if this node's scope/target was previously ALWAYS-approved,
      // auto-approve without prompting.
      const auto = resolveApproval(approvalMemory, {
        target: node.id,
        scope: activeScope,
      });
      if (auto.auto) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        humanResolvers.set(node.id, resolve);
      });
    },
    verify: (n, out) =>
      hooks?.verify?.(n, out) ?? Promise.resolve({ output: out }),
    maxConcurrent: 4,
  });
}

// Current graph run's scope key (set per run so cascade memory is scoped to it).
let activeScope = "graph";

export const useGraphStore = create<GraphStore>((set, get) => ({
  runs: {},
  activeRunId: null,
  pendingHuman: null,
  engine: buildEngine(() => {}),

  run: async (def, opts = {}) => {
    const runId = def.id;
    activeScope = runId;
    const initialNodes: Record<string, GraphRunState> = {};
    for (const n of def.nodes)
      initialNodes[n.id] = { nodeId: n.id, status: "pending" };
    set({
      activeRunId: runId,
      pendingHuman: null,
      runs: {
        ...get().runs,
        [runId]: {
          graphId: runId,
          name: def.name,
          status: "running",
          nodes: initialNodes,
          def,
          createdAt: Date.now(),
        },
      },
    });

    const engine = buildEngine((ev) => {
      const patch = applyEvent(get(), ev);
      if (Object.keys(patch).length > 0) set(patch);
    });
    set({ engine });
    await engine.run(def, opts);
  },

  resolveHuman: (nodeId, decision, feedback) => {
    const pending = get().pendingHuman;
    const scope = pending?.scope ?? nodeId;
    // Record the tri-state decision (always → cascade memory).
    const outcome = applyApproval(
      approvalMemory,
      { target: nodeId, scope },
      decision,
      feedback,
    );
    const resolver = humanResolvers.get(nodeId);
    if (resolver) {
      // Approve continues the loop (hermes nudge gate). Reject fails the node,
      // and the feedback message is surfaced via a synthetic reject.
      resolver(decision === "reject" ? false : true);
      humanResolvers.delete(nodeId);
    }
    set({ pendingHuman: null });
    void outcome;
  },

  cancel: () => {
    // Release any pending human gate first: the engine awaits askHuman, and
    // without resolving it `engine.run()` would hang forever after a cancel.
    // Resolving false + the engine's own `cancelled` check makes the human
    // node unwind without marking it failed.
    for (const resolve of humanResolvers.values()) resolve(false);
    humanResolvers.clear();
    get().engine.cancel();
  },

  getStateOf: (runId, nodeId) => get().runs[runId]?.nodes[nodeId],
}));

function applyEvent(
  s: GraphStore,
  ev: GraphEvent,
): Partial<Pick<GraphStore, "runs" | "pendingHuman">> {
  const runId = ev.runId;
  const run = s.runs[runId];
  if (!run) return {};
  switch (ev.type) {
    case "node-start":
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...run,
            nodes: {
              ...run.nodes,
              [ev.nodeId]: {
                ...run.nodes[ev.nodeId],
                status: "running",
                startedAt: Date.now(),
              },
            },
          },
        },
      };
    case "node-done":
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...run,
            nodes: {
              ...run.nodes,
              [ev.nodeId]: {
                ...run.nodes[ev.nodeId],
                status: "done",
                output: ev.output,
                stepCount: ev.stepCount,
                finishedAt: Date.now(),
              },
            },
          },
        },
      };
    case "node-fail":
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...run,
            nodes: {
              ...run.nodes,
              [ev.nodeId]: {
                ...run.nodes[ev.nodeId],
                status: "failed",
                error: ev.error,
                finishedAt: Date.now(),
              },
            },
          },
        },
      };
    case "human-request":
      return {
        pendingHuman: {
          nodeId: ev.nodeId,
          prompt: ev.prompt,
          scope: ev.runId,
        },
      };
    case "run-done":
      return { runs: { ...s.runs, [runId]: { ...run, status: "done" } } };
    case "run-failed":
      return { runs: { ...s.runs, [runId]: { ...run, status: "failed" } } };
    case "run-cancelled":
      return {
        runs: { ...s.runs, [runId]: { ...run, status: "cancelled" } },
      };
  }
}

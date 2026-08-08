import { hashGraphDef, loadJournalEntry, saveJournalEntry } from "./journal";
import type {
  GraphDef,
  GraphEdge,
  GraphEvent,
  GraphNode,
  GraphRunState,
} from "./types";

/**
 * Graph orchestration engine (P0-1, L4 + H6). A light scheduler (NOT a heavy
 * DAG): nodes are topologically ordered into waves; independent nodes within a
 * wave run in parallel (bounded by a semaphore). Agent nodes delegate to a
 * subagent; judge nodes pick one outgoing edge; human nodes pause for
 * approval; merge nodes concatenate their predecessors' outputs. Prior-node
 * output is injected as context into successors (P1-2). Worker/verify
 * double-round: an agent node may be followed by an optional verify pass.
 *
 * The engine is dependency-injected (runner/human/emit) so it is fully
 * unit-testable without a real LLM or UI.
 */

export type NodeResult = { output?: string; stepCount?: number };

export type GraphEngineDeps = {
  /** Run an agent node by delegating to a subagent. */
  runAgent: (node: GraphNode, context: string) => Promise<NodeResult>;
  /**
   * Run a judge node: return the id of the edge-target node to follow.
   * `branches` maps branch label → target node id.
   */
  judge: (node: GraphNode, context: string) => Promise<string>;
  /** Ask the user to approve/deny a human node. Resolves with `true` = continue. */
  askHuman: (node: GraphNode) => Promise<boolean>;
  /** Emit an event to the frontend store. */
  emit: (ev: GraphEvent) => void;
  /** Optional worker/verify second round: skeptic pass over an agent output. */
  verify?: (node: GraphNode, output: string) => Promise<NodeResult>;
  /** Semaphore width — max parallel nodes in a wave. */
  maxConcurrent?: number;
};

type RuntimeNode = {
  def: GraphNode;
  state: GraphRunState;
  /** Edges OUT of this node. */
  out: GraphEdge[];
  /** Edges INTO this node. */
  in: GraphEdge[];
  context: string;
};

type Run = {
  def: GraphDef;
  nodes: Map<string, RuntimeNode>;
  status: "running" | "done" | "failed" | "cancelled";
  error?: string;
  emit: (ev: GraphEvent) => void;
  deps: GraphEngineDeps;
};

export class GraphEngine {
  private currentRun: Run | null = null;
  private cancelled = false;

  constructor(private deps: GraphEngineDeps) {}

  /** Start (or resume) a graph run. Returns the run id = graph def id. */
  async run(
    def: GraphDef,
    opts: { resume?: boolean } = {},
  ): Promise<{ runId: string; resumed: boolean }> {
    this.cancelled = false;
    const nodes = new Map<string, RuntimeNode>();
    for (const nd of def.nodes) {
      nodes.set(nd.id, {
        def: nd,
        state: { nodeId: nd.id, status: "pending" },
        out: [],
        in: [],
        context: "",
      });
    }
    for (const e of def.edges) {
      nodes.get(e.from)?.out.push(e);
      nodes.get(e.to)?.in.push(e);
    }
    this.currentRun = {
      def,
      nodes,
      status: "running",
      emit: this.deps.emit,
      deps: this.deps,
    };

    const requestHash = hashGraphDef(def);
    if (opts.resume) {
      const prior = await loadJournalEntry(def.id, requestHash);
      if (prior) {
        for (const [id, st] of Object.entries(prior.nodes)) {
          const n = nodes.get(id);
          if (n && st.status !== "pending") n.state = { ...st };
        }
      }
    }

    await this.execute(requestHash);
    return { runId: def.id, resumed: Boolean(opts.resume) };
  }

  cancel(): void {
    this.cancelled = true;
    if (this.currentRun) {
      this.currentRun.status = "cancelled";
      this.deps.emit({ type: "run-cancelled", runId: this.currentRun.def.id });
    }
  }

  private isTerminal(state: GraphRunState): boolean {
    return (
      state.status === "done" ||
      state.status === "failed" ||
      state.status === "cancelled"
    );
  }

  private async execute(requestHash: string): Promise<void> {
    const run = this.currentRun;
    if (!run) return;

    // Topological order (Kahn) — groups into waves of parallel-eligible nodes.
    const indegree = new Map<string, number>();
    for (const n of run.nodes.values()) indegree.set(n.def.id, n.in.length);
    const queue = [...run.nodes.values()].filter(
      (n) => indegree.get(n.def.id) === 0,
    );
    const order: RuntimeNode[] = [];
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(n);
      for (const e of n.out) {
        const t = run.nodes.get(e.to)!;
        indegree.set(e.to, (indegree.get(e.to) ?? 1) - 1);
        if (indegree.get(e.to) === 0) queue.push(t);
      }
    }
    if (order.length !== run.nodes.size) {
      // Cycle detected — refuse.
      run.status = "failed";
      this.deps.emit({
        type: "run-failed",
        runId: run.def.id,
        error: "graph contains a cycle",
      });
      return;
    }

    // Build waves: any node whose predecessors are all in earlier waves is
    // eligible for the current wave.
    const waves: RuntimeNode[][] = [];
    const waveOf = new Map<string, number>();
    for (const n of order) {
      let w = 0;
      for (const e of n.in) {
        const pw = waveOf.get(e.from);
        if (pw !== undefined && pw >= w) w = pw + 1;
      }
      // If a predecessor hasn't been placed yet (not possible with topo order),
      // fall back to the max placed + 1.
      waveOf.set(n.def.id, w);
      if (!waves[w]) waves[w] = [];
      waves[w].push(n);
    }

    // Persist the initial snapshot.
    await this.snapshot(requestHash);

    for (const wave of waves) {
      if (this.cancelled || run.status !== "running") break;
      const workers: Promise<void>[] = [];
      const semaphore = new Semaphore(this.deps.maxConcurrent ?? 4);
      for (const n of wave) {
        workers.push(
          semaphore
            .acquire()
            .then(async () => {
              try {
                if (this.cancelled || run.status !== "running") return;
                if (this.isTerminal(n.state)) return; // resumed — skip done nodes
                await this.executeNode(n);
                await this.snapshot(requestHash);
              } finally {
                semaphore.release();
              }
            }),
        );
      }
      await Promise.all(workers);
    }

    if (run.status === "running") {
      const failed = [...run.nodes.values()].find((n) =>
        n.state.status === "failed"
      );
      if (failed) {
        run.status = "failed";
        this.deps.emit({
          type: "run-failed",
          runId: run.def.id,
          error: failed.state.error ?? "node failed",
        });
      } else {
        run.status = "done";
        this.deps.emit({ type: "run-done", runId: run.def.id });
      }
    }
    await saveJournalEntry({
      graphId: run.def.id,
      name: run.def.name,
      requestHash,
      createdAt: Date.now(),
      nodes: Object.fromEntries(
        [...run.nodes.values()].map((n) => [n.def.id, n.state]),
      ),
    });
  }

  private async snapshot(requestHash: string): Promise<void> {
    const run = this.currentRun;
    if (!run) return;
    await saveJournalEntry({
      graphId: run.def.id,
      name: run.def.name,
      requestHash,
      createdAt: Date.now(),
      nodes: Object.fromEntries(
        [...run.nodes.values()].map((n) => [n.def.id, n.state]),
      ),
    });
  }

  private async executeNode(n: RuntimeNode): Promise<void> {
    const run = this.currentRun!;
    const deps = run.deps;
    const now = Date.now();
    n.state = {
      ...n.state,
      status: "running",
      startedAt: n.state.startedAt ?? now,
      error: undefined,
    };
    deps.emit({ type: "node-start", runId: run.def.id, nodeId: n.def.id });

    try {
      // Build context from all done predecessors (P1-2: output → successor).
      n.context = [...n.in]
        .map((e) => {
          const pred = run.nodes.get(e.from);
          return pred && pred.state.output
            ? `[from ${pred.def.name ?? pred.def.id}]\n${pred.state.output}`
            : "";
        })
        .filter(Boolean)
        .join("\n\n");

      switch (n.def.kind) {
        case "agent": {
          const r = await deps.runAgent(n.def, n.context);
          let output = r.output ?? "";
          let stepCount = r.stepCount;
          // Worker/verify double-round (grok goal_tracker): skeptic pass.
          if (deps.verify && output.trim()) {
            const v = await deps.verify(n.def, output);
            output = v.output ?? output;
            stepCount = (stepCount ?? 0) + (v.stepCount ?? 0);
          }
          n.state = {
            ...n.state,
            status: "done",
            output,
            stepCount,
            finishedAt: Date.now(),
          };
          deps.emit({
            type: "node-done",
            runId: run.def.id,
            nodeId: n.def.id,
            output,
            stepCount,
          });
          break;
        }
        case "judge": {
          const target = await deps.judge(n.def, n.context);
          n.state = {
            ...n.state,
            status: "done",
            output: target,
            finishedAt: Date.now(),
          };
          // Only follow the chosen edge. Prune the unchosen sibling targets by
          // marking them "cancelled" so their later wave no-ops (isTerminal).
          for (const e of n.out) {
            if (e.to === target) continue;
            const sibling = run.nodes.get(e.to);
            if (sibling && sibling.state.status === "pending") {
              sibling.state = {
                nodeId: sibling.def.id,
                status: "cancelled",
              };
            }
          }
          deps.emit({
            type: "node-done",
            runId: run.def.id,
            nodeId: n.def.id,
            output: target,
          });
          break;
        }
        case "human": {
          n.state = {
            ...n.state,
            status: "waiting-human",
          };
          deps.emit({
            type: "human-request",
            runId: run.def.id,
            nodeId: n.def.id,
            prompt: n.def.prompt ?? "",
          });
          // Ask the user (UI wired through GraphRunPanel → engine.approve()).
          const approved = await deps.askHuman(n.def);
          if (this.cancelled) return;
          if (!approved) {
            n.state = {
              ...n.state,
              status: "failed",
              error: "rejected by user",
              finishedAt: Date.now(),
            };
            deps.emit({
              type: "node-fail",
              runId: run.def.id,
              nodeId: n.def.id,
              error: "rejected by user",
            });
            return;
          }
          n.state = {
            ...n.state,
            status: "done",
            output: "approved",
            finishedAt: Date.now(),
          };
          deps.emit({
            type: "node-done",
            runId: run.def.id,
            nodeId: n.def.id,
            output: "approved",
          });
          break;
        }
        case "merge": {
          const parts = [...n.in]
            .map((e) => {
              const pred = run.nodes.get(e.from);
              return pred?.state.output;
            })
            .filter((o): o is string => !!o);
          n.state = {
            ...n.state,
            status: "done",
            output: parts.join("\n\n"),
            finishedAt: Date.now(),
          };
          deps.emit({
            type: "node-done",
            runId: run.def.id,
            nodeId: n.def.id,
            output: parts.join("\n\n"),
          });
          break;
        }
        default: {
          const _exhaustive: never = n.def.kind;
          throw new Error(`unknown node kind: ${String(_exhaustive)}`);
        }
      }
    } catch (e) {
      if (this.cancelled) return;
      n.state = {
        ...n.state,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        finishedAt: Date.now(),
      };
      deps.emit({
        type: "node-fail",
        runId: run.def.id,
        nodeId: n.def.id,
        error: n.state.error ?? "error",
      });
    }
  }
}

/**
 * Bounded semaphore (hermes/grok concurrency limit). `acquire()` resolves when
 * a slot frees; callers must `release()` in a finally block.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }
}


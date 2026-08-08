/**
 * Graph engine types (L4 + H6). A graph is a light orchestration layer (not a
 * heavy DAG): a sequence of nodes that may run in parallel waves, with agent
 * nodes delegating to subagents, judge nodes choosing a branch, human nodes
 * pausing for approval, and merge nodes aggregating predecessor outputs.
 */

export type NodeKind = "agent" | "judge" | "human" | "merge";

export type NodeStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "waiting-human"
  | "cancelled";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  name?: string;
  /** For agent nodes: the subagent type (explore/code/…). */
  agent?: string;
  /** The task prompt (agent) or question (judge/human). */
  prompt?: string;
  /**
   * For judge nodes: branch choices keyed by edge target id. The judge picks
   * one; only that outgoing edge is followed.
   */
  branches?: Record<string, string>;
};

export type GraphEdge = {
  from: string;
  to: string;
};

export type GraphDef = {
  id: string;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphRunState = {
  nodeId: string;
  status: NodeStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  stepCount?: number;
};

export type GraphRunStatus = "running" | "done" | "failed" | "cancelled";

export type GraphRun = {
  graphId: string;
  name: string;
  status: GraphRunStatus;
  nodes: Record<string, GraphRunState>;
  /** The node definitions, so the panel can render kind/label/prompt. */
  def: GraphDef;
  createdAt: number;
};

/** Event emitted by the engine to the frontend store. */
export type GraphEvent =
  | { type: "node-start"; runId: string; nodeId: string }
  | { type: "node-done"; runId: string; nodeId: string; output?: string; stepCount?: number }
  | { type: "node-fail"; runId: string; nodeId: string; error: string }
  | { type: "human-request"; runId: string; nodeId: string; prompt: string }
  | { type: "run-done"; runId: string }
  | { type: "run-failed"; runId: string; error: string }
  | { type: "run-cancelled"; runId: string };

/** Snapshot entry persisted to the journal so a run can resume. */
export type JournalEntry = {
  graphId: string;
  name: string;
  /** Dedup key — running the same graph id again overwrites the prior entry. */
  requestHash: string;
  createdAt: number;
  nodes: Record<string, GraphRunState>;
};

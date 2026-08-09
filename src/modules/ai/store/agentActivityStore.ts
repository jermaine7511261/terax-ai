import { create } from "zustand";

export type ActivityKind = "subagent" | "coding" | "external" | "graph";

export type ActivityStatus = "running" | "done" | "error";

export type AgentActivity = {
  id: string;
  kind: ActivityKind;
  type: string;
  prompt: string;
  status: ActivityStatus;
  step: string | null;
  startedAt: number;
  durationMs?: number;
  summary?: string;
  stepCount?: number;
  /**
   * Delegation depth in the worker tree (root parent = 0). Used by the panel
   * to indent/nest concurrent workers (P0-2).
   */
  depth?: number;
  /** Parent activity id ( parentID tree). */
  parentId?: string;
  /** Group key shared by a parallel `delegate_many` fan-out, so its workers
   * render as one visually-grouped cluster. */
  group?: string;
};

type State = {
  activities: AgentActivity[];
  // Flushed from the store once shown (keeps the list clean for next runs).
  start: (a: AgentActivity) => void;
  updateStep: (id: string, step: string) => void;
  finish: (id: string, summary: string, stepCount: number) => void;
  fail: (id: string, error: string) => void;
  clearDone: () => void;
};

export const useAgentActivityStore = create<State>((set) => ({
  activities: [],

  start: (a) =>
    set((s) => ({
      activities: [{ ...a, status: "running", step: null }, ...s.activities],
    })),

  updateStep: (id, step) =>
    set((s) => ({
      activities: s.activities.map((a) =>
        a.id === id ? { ...a, step } : a,
      ),
    })),

  finish: (id, summary, stepCount) =>
    set((s) => ({
      activities: s.activities.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "done",
              step: null,
              summary,
              stepCount,
              durationMs: Date.now() - a.startedAt,
            }
          : a,
      ),
    })),

  fail: (id, error) =>
    set((s) => ({
      activities: s.activities.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "error",
              step: null,
              summary: error,
              durationMs: Date.now() - a.startedAt,
            }
          : a,
      ),
    })),

  clearDone: () =>
    set((s) => ({
      activities: s.activities.filter((a) => a.status === "running"),
    })),
}));

/** Hook: list of activities for display, capped at 8. */
export function useRecentActivities(): AgentActivity[] {
  const all = useAgentActivityStore((s) => s.activities);
  return all.slice(0, 8);
}

let _nextId = 0;
export function newActivityId(): string {
  _nextId++;
  return `act-${Date.now().toString(36)}-${_nextId}`;
}

// Breakpoint state shared between the editor gutter and the debug panel.
// Keyed by absolute file path -> set of 1-based line numbers. Editing a
// breakpoint here (toggle/clear/set) is the single source of truth; the
// editor gutter renders it and the debug session syncs via `setBreakpoints`.

import { create } from "zustand";

type BreakpointState = {
  /** path -> sorted 1-based line numbers that have a breakpoint. */
  byPath: Record<string, number[]>;
  /** Path+line currently at the paused instruction (highlighted). */
  stoppedAt: { path: string; line: number } | null;
  toggle: (path: string, line: number) => void;
  clearPath: (path: string) => void;
  setStoppedAt: (at: { path: string; line: number } | null) => void;
};

export const useBreakpointStore = create<BreakpointState>((set) => ({
  byPath: {},
  stoppedAt: null,
  toggle: (path, line) =>
    set((s) => {
      const cur = s.byPath[path] ?? [];
      const has = cur.includes(line);
      const next = has ? cur.filter((l) => l !== line) : [...cur, line];
      next.sort((a, b) => a - b);
      return {
        byPath: { ...s.byPath, [path]: next.length ? next : [] },
      };
    }),
  clearPath: (path) =>
    set((s) => {
      if (!s.byPath[path]) return s;
      const byPath = { ...s.byPath };
      delete byPath[path];
      return { byPath };
    }),
  setStoppedAt: (at) => set({ stoppedAt: at }),
}));

/** Sorted 1-based lines with breakpoints for a path. */
export function linesFor(path: string): number[] {
  return useBreakpointStore.getState().byPath[path] ?? [];
}

/** Toggle a breakpoint on a line for a path (single source of truth). */
export function toggleBreakpoint(path: string, line: number): void {
  useBreakpointStore.getState().toggle(path, line);
}

/** The line currently paused-at for a path (highlighted), or null. */
export function stoppedAtFor(path: string): number | null {
  const at = useBreakpointStore.getState().stoppedAt;
  return at && at.path === path ? at.line : null;
}

/** Subscribe to store changes; returns an unsubscribe fn. */
export function subscribeBreakpoints(
  listener: (s: BreakpointState) => void,
): () => void {
  return useBreakpointStore.subscribe(listener);
}


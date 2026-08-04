import { create } from "zustand";

/**
 * In-session project memory store (pattern mirrors todoStore).
 *
 * Two-level design:
 *  - In-session: entries live here keyed by chat session id, so a note written
 *    mid-conversation is immediately available to subsequent turns (merged into
 *    the system prompt on the next run).
 *  - Cross-session: each entry is ALSO persisted to YAMET.md via
 *    transport.appendProjectMemory/updateProjectMemory, so it survives restart.
 */
export type ProjectMemoryEntry = {
  id: string;
  content: string;
  createdAt: number;
};

type MemoryState = {
  /** Map of sessionId -> memory entries written this session. */
  bySession: Record<string, ProjectMemoryEntry[]>;
  addMemory: (sessionId: string, entry: ProjectMemoryEntry) => void;
  clearSession: (sessionId: string) => void;
};

export const useMemoryStore = create<MemoryState>((set) => ({
  bySession: {},

  addMemory: (sessionId, entry) =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: [
          ...(s.bySession[sessionId] ?? []).filter((e) => e.id !== entry.id),
          entry,
        ],
      },
    })),

  clearSession: (sessionId) =>
    set((s) => {
      const next = { ...s.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));

export function getSessionMemory(
  sessionId: string | null,
): ProjectMemoryEntry[] {
  if (!sessionId) return [];
  return useMemoryStore.getState().bySession[sessionId] ?? [];
}

/** Render session memory entries as a delimited block for the system prompt. */
export function formatSessionMemory(
  entries: ProjectMemoryEntry[],
): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => `- ${e.content.replace(/\r?\n/g, " ")}`);
  return `<yamet-session-memory>\n${lines.join("\n")}\n</yamet-session-memory>`;
}

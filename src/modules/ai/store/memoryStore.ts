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
  /** Who wrote this: the agent tool (`tool`) or the auto-settle nudge (`auto`). */
  source?: "tool" | "auto";
};

type MemoryState = {
  /** Map of sessionId -> memory entries written this session. */
  bySession: Record<string, ProjectMemoryEntry[]>;
  addMemory: (sessionId: string, entry: ProjectMemoryEntry) => void;
  removeMemory: (sessionId: string, id: string) => void;
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

  removeMemory: (sessionId, id) =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: (s.bySession[sessionId] ?? []).filter((e) => e.id !== id),
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

/**
 * Relevance recall (P1-4,  `select_context`): score a memory line against
 * a query by counting how many non-trivial query tokens appear in it. Returns
 * a 0..1 score. Trivial tokens (stopwords/common words) are ignored.
 */
export function recallScore(line: string, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
  if (tokens.length === 0) return 0;
  const lineLower = line.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (/[\p{Script=Han}]/u.test(t)) {
      // CJK has no spaces: a whole sentence is one token, so `includes(t)`
      // would only match verbatim. Use 2-gram overlap instead so a longer
      // query (e.g. "记忆注入全量拼接") still recalls lines containing any of
      // its bigrams ("记忆"/"注入"/…). Score = matched grams / total grams.
      const grams = new Set<string>();
      for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2));
      if (grams.size === 0) continue;
      let hit = 0;
      for (const g of grams) if (lineLower.includes(g)) hit++;
      score += hit / grams.size;
    } else {
      // Latin/alnum tokens keep exact-word semantics.
      if (lineLower.includes(t)) score += 1;
    }
  }
  return score / tokens.length;
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "with", "this", "that", "from", "have",
  "was", "has", "you", "how", "what", "when", "where", "which", "please",
]);

/**
 * Rank a list of memory lines by relevance to the query, returning the top
 * `limit` hits that score above `threshold`. Pure — unit-tested.
 *
 * P3-11: filtering keeps the lexical `recallScore` floor (stable recall);
 * ordering uses TF-IDF (`tfidfScore`) so lines with rarer, more frequent
 * query tokens rank above mere substring hits.
 */
export function recallTop(
  lines: string[],
  query: string,
  opts: { limit?: number; threshold?: number } = {},
): string[] {
  const limit = opts.limit ?? 8;
  const threshold = opts.threshold ?? 0;
  const filtered = lines
    .map((l) => ({ l, s: recallScore(l, query) }))
    .filter((x) => x.s > threshold);
  const idf = computeIdf(lines, query);
  return filtered
    .sort((a, b) => tfidfScore(b.l, query, idf) - tfidfScore(a.l, query, idf))
    .slice(0, limit)
    .map((x) => x.l);
}

function wordFreq(line: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of line
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return freq;
}

/** Precompute inverse document frequency for the query tokens across lines. */
export function computeIdf(lines: string[], query: string): Map<string, number> {
  const idf = new Map<string, number>();
  const n = Math.max(1, lines.length);
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  for (const t of tokens) {
    const df = lines.filter((l) => l.toLowerCase().includes(t)).length;
    idf.set(t, Math.log(n / Math.max(1, df)));
  }
  return idf;
}

/**
 * TF-IDF lexical relevance (P3-11): Latin tokens score `tf × (1 + idf)`;
 * CJK tokens keep 2-gram overlap. Normalized by query token count (0..1).
 */
export function tfidfScore(
  line: string,
  query: string,
  idf: Map<string, number>,
): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
  if (tokens.length === 0) return 0;
  const lineLower = line.toLowerCase();
  const freq = wordFreq(line);
  const totalWords = [...freq.values()].reduce((a, b) => a + b, 0) || 1;
  let score = 0;
  for (const t of tokens) {
    if (/[\p{Script=Han}]/u.test(t)) {
      const grams = new Set<string>();
      for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2));
      if (grams.size === 0) continue;
      let hit = 0;
      for (const g of grams) if (lineLower.includes(g)) hit++;
      score += hit / grams.size;
    } else {
      const n = freq.get(t) ?? 0;
      if (n > 0) {
        score += (n / totalWords) * (1 + (idf.get(t) ?? 0));
      }
    }
  }
  return score / tokens.length;
}

import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { redactSensitive } from "../lib/redact";
import { loadAll, loadMessages } from "../lib/sessions";
import { parseBlock } from "../lib/transport";
import { getSessionMemory } from "../store/memoryStore";
import type { ToolContext } from "./context";

/**
 * Cross-session semantic recall (★ H1: "search its own past
 * conversations"). `search_memories(query)` matches recent chat sessions and
 * project memory entries, returning ranked snippets injected into context.
 *
 * Search core (`extractSessionText` / `scoreHit` / `snippetAround` /
 * `searchEntries`) is pure and unit-tested; the execute layer only assembles
 * data (sessions store + YaMet.md memory).
 */

const MAX_SESSIONS_SCAN = 100;
const MAX_RESULTS = 8;
const SNIPPET_MAX = 200;
const SESSION_TEXT_MAX = 50 * 1024;

export type MemorySearchEntry = {
  kind: "session" | "memory";
  title: string;
  time: number;
  text: string;
};

export type SearchResult = {
  kind: string;
  title: string;
  time: number;
  snippet: string;
  score: number;
};

/** Flatten chat messages into one searchable text (`[role] text` lines). */
export function extractSessionText(
  messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>,
): string {
  const parts: string[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
        parts.push(`[${m.role}] ${p.text.trim()}`);
      }
    }
  }
  return parts.join("\n").slice(0, SESSION_TEXT_MAX);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count occurrences of every query word in `text` (case-insensitive). */
export function scoreHit(text: string, queryWords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of queryWords) {
    if (!w) continue;
    const m = lower.match(new RegExp(escapeRegex(w), "g"));
    if (m) score += m.length;
  }
  return score;
}

/** Slice the text around the first query-word hit, capped at `max` chars. */
export function snippetAround(
  text: string,
  queryWords: string[],
  max = SNIPPET_MAX,
): string {
  const lower = text.toLowerCase();
  let best = -1;
  for (const w of queryWords) {
    if (!w) continue;
    const idx = lower.indexOf(w.toLowerCase());
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  if (best === -1) return text.slice(0, max);
  // Center the first hit in the window so the snippet always contains it.
  const half = Math.floor(max / 2);
  const start = Math.max(0, best - half);
  const end = Math.min(text.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/** Rank entries by query-word hits, return top N with snippets. */
export function searchEntries(
  entries: MemorySearchEntry[],
  query: string,
  topN = MAX_RESULTS,
): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries
    .map((e) => ({ e, score: scoreHit(e.text, words) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ e, score }) => ({
      kind: e.kind,
      title: e.title,
      time: e.time,
      snippet: snippetAround(e.text, words),
      score,
    }));
}

export function buildSearchMemoriesTools(ctx: ToolContext) {
  return {
    search_memories: tool({
      description:
        "Search past chat sessions and project memory for a query (cross-session recall, ★ H1). Returns up to 8 ranked snippets with session titles and timestamps. Read-only, auto-executes — use it to recall how something was done before or to find a past decision.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search query — a phrase or keywords, e.g. 'how do we deploy'."),
        mode: z
          .enum(["vector", "fts", "hybrid"])
          .optional()
          .describe("搜索模式：vector（语义/关键词）、fts（全文 BM25）、hybrid（混合，默认）"),
      }),
      execute: async ({ query, mode }) => {
        const q = query.trim();
        if (!q) return { error: "empty query", results: [] };

        const entries: MemorySearchEntry[] = [];

        // 1) Project memory: this session's store + persisted YaMet.md block.
        const sessionId = ctx.getSessionId();
        for (const m of getSessionMemory(sessionId)) {
          entries.push({
            kind: "memory",
            title: "项目记忆（本会话）",
            time: m.createdAt,
            text: m.content,
          });
        }
        const workspaceRoot = ctx.getWorkspaceRoot();
        if (workspaceRoot) {
          try {
            const r = await native.readFile(
              `${workspaceRoot.replace(/\/$/, "")}/YaMet.md`,
            );
            if (r.kind === "text") {
              for (const line of parseBlock(r.content).lines) {
                const content = line.replace(/^-\s*/, "").trim();
                if (content) {
                  entries.push({
                    kind: "memory",
                    title: "项目记忆（YaMet.md）",
                    time: 0,
                    text: content,
                  });
                }
              }
            }
          } catch {
            // No YaMet.md yet.
          }
        }

        // 2) Recent chat sessions (most recently updated first).
        try {
          const { sessions } = await loadAll();
          const recent = [...sessions]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_SESSIONS_SCAN);
          for (const s of recent) {
            const msgs = await loadMessages(s.id);
            if (!msgs) continue;
            const text = extractSessionText(msgs);
            if (!text) continue;
            entries.push({
              kind: "session",
              title: s.title || s.id,
              time: s.updatedAt,
              text,
            });
          }
        } catch {
          // Session store unavailable — memory entries still searched.
        }


        // §3.5.2 FTS mode: use Rust BM25 full-text search when requested.
        const searchMode = mode ?? "hybrid";
        let results: SearchResult[];

        if (searchMode === "fts") {
          // Pure FTS: build corpus from entries and call Rust BM25.
          const corpus = entries.map((e, i) => ({
            id: String(i),
            text: e.text,
          }));
          if (corpus.length > 0) {
            const ftsHits = await native.memoryFtsSearch({ corpus, query: q, limit: MAX_RESULTS });
            results = ftsHits.map((hit) => {
              const idx = parseInt(hit.id, 10);
              const entry = entries[idx];
              return {
                kind: entry?.kind ?? "memory",
                title: entry?.title ?? hit.id,
                time: entry?.time ?? 0,
                snippet: hit.snippet,
                score: hit.score,
              };
            });
          } else {
            results = [];
          }
        } else if (searchMode === "hybrid") {
          // Hybrid: combine lexical + FTS scores.
          const lexicalResults = searchEntries(entries, q);
          const corpus = entries.map((e, i) => ({
            id: String(i),
            text: e.text,
          }));
          let ftsResults: SearchResult[] = [];
          if (corpus.length > 0) {
            const ftsHits = await native.memoryFtsSearch({ corpus, query: q, limit: MAX_RESULTS });
            ftsResults = ftsHits.map((hit) => {
              const idx = parseInt(hit.id, 10);
              const entry = entries[idx];
              return {
                kind: entry?.kind ?? "memory",
                title: entry?.title ?? hit.id,
                time: entry?.time ?? 0,
                snippet: hit.snippet,
                score: hit.score,
              };
            });
          }
          // Merge: union by title, max score wins.
          const seen = new Map<string, SearchResult>();
          for (const r of [...lexicalResults, ...ftsResults]) {
            const key = r.title + r.kind;
            const existing = seen.get(key);
            if (!existing || r.score > existing.score) {
              seen.set(key, r);
            }
          }
          results = [...seen.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS);
        } else {
          // Default vector/lexical mode.
          results = searchEntries(entries, q);
        }
        return {
          results: results.map((r) => ({
            ...r,
            snippet: redactSensitive(r.snippet),
          })),
        };
      },
    }),
  } as const;
}

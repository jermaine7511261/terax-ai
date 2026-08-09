/**
 * S7 FastContext budget (PraisonAI `context_injector.py`): constrain how much
 * code context a retrieval subagent can pull in, so a grep/read burst can't
 * flood the parent context. Pure — no I/O, unit-tested.
 *
 * `prioritize_precision` semantics: when true, return FEWER, more relevant
 * matches (tighter caps); when false, prefer coverage.
 */

/** Default budget (PraisonAI: max_files=10, max_lines_per_file=100,
 *  max_tokens=4000). */
export const FAST_CONTEXT_DEFAULT = {
  maxFiles: 10,
  maxLinesPerFile: 100,
  maxTokens: 4000,
} as const;

export type FastContextBudget = {
  maxFiles: number;
  maxLinesPerFile: number;
  maxTokens: number;
};

/** A single code hit: file path + optional line range (FileMatch/LineRange). */
export type FileMatch = {
  path: string;
  /** 1-based line range (inclusive). Omitted = whole-file read. */
  startLine?: number;
  endLine?: number;
  /** Captured line text (for grep hits). */
  text?: string;
};

/** Apply the budget to a set of matches. Returns the kept matches + the
 *  estimated tokens they represent, after trimming to the caps. */
export function applyFastContextBudget(
  matches: FileMatch[],
  budget: FastContextBudget = FAST_CONTEXT_DEFAULT,
): { matches: FileMatch[]; tokens: number } {
  // Cap files first.
  const cappedFiles = matches.slice(0, budget.maxFiles);
  const kept: FileMatch[] = [];
  let tokens = 0;

  for (const m of cappedFiles) {
    const start = m.startLine ?? 1;
    const end = m.endLine ?? start;
    const lines = Math.max(1, end - start + 1);
    const cappedLines = Math.min(lines, budget.maxLinesPerFile);
    const textLen = m.text?.length ?? Math.min(cappedLines * 40, 4000);
    const estTokens = textLen / 4;
    if (tokens + estTokens > budget.maxTokens) break;
    // Trim the line range to the per-file cap.
    kept.push({
      ...m,
      startLine: start,
      endLine: Math.min(end, start + cappedLines - 1),
    });
    tokens += estTokens;
  }
  return { matches: kept, tokens: Math.floor(tokens) };
}

/**
 * `prioritize_precision`: sort matches so the most relevant come first, then
 * apply a tighter cap. Relevance = more query terms matched in the text
 * (or the line range size as a tiebreak: smaller is more precise).
 */
export function prioritizePrecision(
  matches: FileMatch[],
  queryTerms: string[],
  precisionCap: number,
): FileMatch[] {
  const terms = queryTerms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  if (terms.length === 0) return matches.slice(0, precisionCap);
  const scored = matches.map((m) => {
    const text = (m.text ?? "").toLowerCase();
    const hits = terms.filter((t) => text.includes(t)).length;
    const rangeSize = (m.endLine ?? m.startLine ?? 1) - (m.startLine ?? 1);
    return { m, hits, rangeSize };
  });
  scored.sort((a, b) => b.hits - a.hits || a.rangeSize - b.rangeSize);
  return scored.slice(0, precisionCap).map((x) => x.m);
}

/**
 * Budget-string for the researcher subagent prompt: declares the caps so the
 * model knows how much it may pull (injection, not enforcement — the tool
 * layer enforces via `applyFastContextBudget`).
 */
export function fastContextPrompt(budget: FastContextBudget = FAST_CONTEXT_DEFAULT): string {
  return `FastContext budget: read at most ${budget.maxFiles} files, ${budget.maxLinesPerFile} lines each, ~${budget.maxTokens} tokens total. Prioritize precision over coverage — pull only what you need to answer.`;
}

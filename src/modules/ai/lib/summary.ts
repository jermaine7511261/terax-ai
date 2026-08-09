/**
 * Subagent summary capping ( summary-budget-cap), fixed:
 *  - PROSE summaries are truncated at a generous cap, cut at a SENTENCE /
 *    PARAGRAPH boundary (never mid-word), with a clear marker.
 *  - STRUCTURED output (JSON / fenced blocks) is never clipped at a prose
 *    boundary — deep_search researcher/verifier JSON must stay intact or the
 *    downstream parser silently discards the whole phase. Only an absurdly
 *    large blob (> STRUCTURED_SUMMARY_CAP) is cut.
 *
 * Pure — unit-tested. Mirrored in Rust `agents::cap_summary`.
 */

/** Prose summary budget. Raised from 4000 so real research/audit summaries
 *  survive; the parent's context compaction handles overflow instead. */
export const PROSE_SUMMARY_CAP = 16_000;

/** Hard safety cap for structured output. Deep-search JSON regularly exceeds
 *  4KB; only a runaway blob beyond this is cut. */
export const STRUCTURED_SUMMARY_CAP = 200_000;

export type CapSummaryResult = { text: string; truncated: boolean };

/** True when `raw` looks like structured output that must not be clipped at a
 *  prose boundary: a JSON object/array, or a fenced code block. */
export function isStructuredOutput(raw: string): boolean {
  const t = raw.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return true;
  return /^```(?:json|ya?ml|yaml|xml|toml|md|markdown)?\s*\n/.test(t);
}

/** Index just after the last sentence/paragraph break within [floor, limit).
 *  Falls back to `limit` when no meaningful break exists. */
export function cutAtBoundary(raw: string, limit: number, floorRatio = 0.6): number {
  if (limit <= 0) return 0;
  const head = raw.slice(0, limit);
  const floor = Math.floor(limit * floorRatio);
  const candidates = [
    head.lastIndexOf("\n\n"),
    head.lastIndexOf(". "),
    head.lastIndexOf("\n"),
    head.lastIndexOf(". "),
    head.lastIndexOf(". "),
    head.lastIndexOf("."),
    head.lastIndexOf(" "),
  ];
  for (const idx of candidates) {
    if (idx >= floor) return Math.min(idx + 1, limit);
  }
  return limit;
}

/** Cap a subagent summary. Returns the (possibly truncated) text and whether
 *  truncation happened. Structured output is exempted up to its own cap. */
export function capSummary(raw: string, cap = PROSE_SUMMARY_CAP): CapSummaryResult {
  if (raw.length <= cap) return { text: raw, truncated: false };
  if (isStructuredOutput(raw)) {
    if (raw.length <= STRUCTURED_SUMMARY_CAP) return { text: raw, truncated: false };
    return { text: `${raw.slice(0, STRUCTURED_SUMMARY_CAP)}…[truncated]`, truncated: true };
  }
  const cut = cutAtBoundary(raw, cap);
  return { text: `${raw.slice(0, cut)}…[truncated]`, truncated: true };
}

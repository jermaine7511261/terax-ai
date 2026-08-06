export type HighlightRange = {
  start: number;
  end: number;
};

/** Case-insensitive ranges of `query` occurrences inside `text`. */
export function highlightRanges(text: string, query: string): HighlightRange[] {
  if (!query) return [];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: HighlightRange[] = [];
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + needle.length });
    i = idx + needle.length;
  }
  return ranges;
}

export type SearchHitLike = {
  rel: string;
  text: string;
};

/** Keep only hits whose text mentions the query (case-insensitive). */
export function filterMatches<T extends SearchHitLike>(
  hits: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...hits];
  return hits.filter((h) => h.text.toLowerCase().includes(q));
}

/** Group hits by relative path, returning `[rel, hits]` entries sorted by path. */
export function groupByFile<T extends { rel: string }>(
  hits: readonly T[],
): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const h of hits) {
    const arr = m.get(h.rel) ?? [];
    arr.push(h);
    m.set(h.rel, arr);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

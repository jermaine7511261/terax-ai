/**
 * Pure memory-block compressor (Round 32 P0-2 #5-8, R32.5 ratio model).
 *
 * Ratio model (R32.5): the block has a capacity cap (MEMORY_CAP). Compression
 * triggers when `entries.length > cap * thresholdRatio` (default 0.5 → 50
 * entries at cap 100). The `protectRecent` newest entries are never merged;
 * from the remaining compressible pool, the newest `cap * targetRatio −
 * protectRecent` entries are kept and everything older merges into a single
 * marked summary line (default target 0.2 → the block settles near 20% of cap).
 * Lines already marked as summaries are never re-merged.
 *
 * Operates on plain `- content` memory lines (as persisted in memory.md /
 * YaMet.md). Lines without an explicit age sort oldest-first by position;
 * the file is append-only so earlier lines are older.
 */
export type CompressibleLine = {
  /** Bare entry content (without the leading `- `). */
  content: string;
  /** Creation time for "recent" ordering. Omitted for file lines (position is the age proxy). */
  createdAt?: number;
  /** True when this line is already a compression summary (never re-merged). */
  summary?: boolean;
};

/** Marker prefix for merged summaries; such lines are exempt from re-merge. */
export const MEMORY_SUMMARY_PREFIX = "<!-- memory-summary -->";

export const MEMORY_SUMMARY_MAX_CHARS = 600;

/** Memory-block capacity (entries) used as the ratio base for compression. */
export const MEMORY_CAP = 100;

export type CompressResult = {
  /** Entries after compression (kept + the new summary), order preserved. */
  kept: CompressibleLine[];
  /** The generated summary line content ("" when nothing was merged). */
  summary: string;
  /** Number of entries merged into the summary. */
  compressed: number;
};

export function compressMemory(
  entries: CompressibleLine[],
  opts: {
    /** Capacity base for ratios (default MEMORY_CAP = 100). */
    cap?: number;
    /** Trigger ratio: compress when entries > cap * thresholdRatio (0–1). */
    thresholdRatio: number;
    /** Settle ratio: keep ≈ cap * targetRatio entries after compression (0–1). */
    targetRatio: number;
    protectRecent: number;
  },
): CompressResult {
  const cap = Math.max(1, Math.round(opts.cap ?? MEMORY_CAP));
  const threshold = Math.max(1, Math.round(cap * opts.thresholdRatio));
  if (entries.length <= threshold || opts.targetRatio <= 0) {
    return { kept: entries, summary: "", compressed: 0 };
  }

  // Position-aware age: dated entries compare by createdAt (newer wins);
  // undated file lines use position (later = newer, append-only file).
  const withIdx = entries.map((e, idx) => ({ e, idx }));
  const cmpNewest = (
    a: { e: CompressibleLine; idx: number },
    b: { e: CompressibleLine; idx: number },
  ): number => {
    const aD = a.e.createdAt;
    const bD = b.e.createdAt;
    if (aD !== undefined && bD !== undefined) return bD - aD;
    if (aD !== undefined) return -1; // dated entries are newer
    if (bD !== undefined) return 1;
    return b.idx - a.idx; // both file lines: later position = newer
  };

  // Newest `protectRecent` entries first.
  const protectedSet = new Set<CompressibleLine>(
    [...withIdx]
      .sort(cmpNewest)
      .slice(0, Math.max(0, opts.protectRecent))
      .map((x) => x.e),
  );

  // Compressible pool: not protected, not already a summary.
  const pool = entries.filter(
    (e) => !protectedSet.has(e) && !isSummaryLine(e),
  );
  if (pool.length === 0) return { kept: entries, summary: "", compressed: 0 };

  const poolIdx = withIdx.filter((x) => pool.includes(x.e));
  const poolByAge = [...poolIdx].sort((a, b) => {
    const aD = a.e.createdAt;
    const bD = b.e.createdAt;
    if (aD !== undefined && bD !== undefined) return aD - bD;
    if (aD !== undefined) return 1; // undated (file) lines are older
    if (bD !== undefined) return -1;
    return a.idx - b.idx; // both file lines: earlier = older
  });
  // Keep the newest `cap * targetRatio − protectRecent` pool entries; merge
  // the rest. Protect wins when it already exceeds the settle target.
  const keepFromPool = Math.max(
    0,
    Math.round(cap * opts.targetRatio) - Math.max(0, opts.protectRecent),
  );
  const mergeCount = Math.max(1, pool.length - keepFromPool);
  const toMerge = new Set(poolByAge.slice(0, mergeCount).map((x) => x.e));
  if (toMerge.size === 0) return { kept: entries, summary: "", compressed: 0 };

  const merged = entries
    .filter((e) => toMerge.has(e))
    .map((e) => stripSummaryMarker(e.content).trim())
    .filter(Boolean);

  const summary = merged.length
    ? `${MEMORY_SUMMARY_PREFIX} Summary: ${joinFirstSentences(merged)}`
    : "";

  const kept = entries.filter((e) => !toMerge.has(e));
  return { kept, summary, compressed: merged.length };
}

export function isSummaryLine(line: CompressibleLine): boolean {
  return line.content.startsWith(MEMORY_SUMMARY_PREFIX);
}

function stripSummaryMarker(content: string): string {
  return content.startsWith(MEMORY_SUMMARY_PREFIX)
    ? content.slice(MEMORY_SUMMARY_PREFIX.length)
    : content;
}

/** Join merged entries into a bounded single-line summary (first sentences). */
function joinFirstSentences(lines: string[]): string {
  const parts = lines.map((l) => {
    const sentence = l.split(/[。.!?！？；;]/)[0].trim();
    return sentence || l;
  });
  let out = parts.join("；");
  if (out.length > MEMORY_SUMMARY_MAX_CHARS) {
    out = `${out.slice(0, MEMORY_SUMMARY_MAX_CHARS).trimEnd()}…`;
  }
  return out;
}

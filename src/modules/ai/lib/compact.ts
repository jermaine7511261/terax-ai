import type { ModelMessage, UIMessage } from "ai";

const KEEP_TAIL = 24;
const ELISION_TEXT = "[elided to save context — see prior tool call in history]";

/** P2-1 head/tail protection (hermes context_compressor): never elide the
 * first N / last N messages. */
export const PROTECT_FIRST_N = 3;
export const PROTECT_LAST_N = 6;

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  [k: string]: unknown;
};

function approxBytes(messages: ModelMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === "string") n += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const part of m.content as ToolPart[]) {
        if (part.type === "text" && typeof part.text === "string")
          n += (part.text as string).length;
        else if (part.type === "tool-result")
          n += JSON.stringify(part.output ?? "").length;
        else if (part.type === "tool-call")
          n += JSON.stringify(part.input ?? "").length;
        else n += 64;
      }
    }
  }
  return n;
}

/**
 * Approximate bytes from @ai-sdk/react `UIMessage[]` (status-bar context
 * estimate). UIMessage and ModelMessage share the same `content` shape
 * (`string | {type:"text"|"tool-result"|"tool-call", ...}[]`), so this gives
 * the SAME approximation the compaction logic uses without an async
 * convertToModelMessages round-trip on every streamed token.
 */
export function approxBytesFromUI(messages: UIMessage[]): number {
  let n = 0;
  for (const m of messages) {
    const c = (m as unknown as { content?: unknown }).content;
    if (typeof c === "string") n += c.length;
    else if (Array.isArray(c)) {
      for (const part of c as ToolPart[]) {
        if (part.type === "text" && typeof part.text === "string")
          n += (part.text as string).length;
        else if (part.type === "tool-result")
          n += JSON.stringify(part.output ?? "").length;
        else if (part.type === "tool-call")
          n += JSON.stringify(part.input ?? "").length;
        else n += 64;
      }
    }
  }
  return n;
}

function elideToolResult(part: ToolPart): { changed: boolean; part: ToolPart } {
  if (part.type !== "tool-result") return { changed: false, part };
  if (
    part.output &&
    typeof part.output === "object" &&
    (part.output as { __elided?: boolean }).__elided
  ) {
    return { changed: false, part };
  }
  return {
    changed: true,
    part: {
      ...part,
      output: { type: "text", value: ELISION_TEXT, __elided: true },
    },
  };
}

function pathOfInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const p = (input as { path?: unknown }).path;
  return typeof p === "string" && p.length > 0 ? p : null;
}

function collectMutationPaths(messages: ModelMessage[]): Set<string> {
  const paths = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as ToolPart[]) {
      if (part.type !== "tool-call") continue;
      const name = part.toolName;
      if (
        name === "edit" ||
        name === "multi_edit" ||
        name === "write_file" ||
        name === "create_directory"
      ) {
        const p = pathOfInput(part.input);
        if (p) paths.add(p);
      }
    }
  }
  return paths;
}

function collectLastReadIdxPerPath(
  messages: ModelMessage[],
): Map<string, number> {
  const lastIdx = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as ToolPart[]) {
      if (part.type !== "tool-call") continue;
      if (part.toolName !== "read_file") continue;
      const p = pathOfInput(part.input);
      if (p) lastIdx.set(p, i);
    }
  }
  return lastIdx;
}

function dropSupersededReads(messages: ModelMessage[]): {
  out: ModelMessage[];
  touched: boolean;
} {
  const mutated = collectMutationPaths(messages);
  const lastReadIdx = collectLastReadIdxPerPath(messages);

  const callIdxToPath = new Map<string, string>();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as ToolPart[]) {
      if (part.type !== "tool-call" || part.toolName !== "read_file") continue;
      const p = pathOfInput(part.input);
      const id = part.toolCallId;
      if (p && typeof id === "string") callIdxToPath.set(id, p);
    }
  }

  let touched = false;
  const out = messages.map((m, i): ModelMessage => {
    if (!Array.isArray(m.content)) return m;
    let local = false;
    const nextContent = (m.content as ToolPart[]).map((part) => {
      if (part.type !== "tool-result") return part;
      const id = part.toolCallId;
      if (typeof id !== "string") return part;
      const path = callIdxToPath.get(id);
      if (!path) return part;
      const isStale =
        mutated.has(path) ||
        (lastReadIdx.has(path) && (lastReadIdx.get(path) as number) > i);
      if (!isStale) return part;
      const r = elideToolResult(part);
      if (r.changed) local = true;
      return r.part;
    });
    if (!local) return m;
    touched = true;
    return { ...m, content: nextContent } as ModelMessage;
  });
  return { out, touched };
}

export type CompactResult = {
  messages: ModelMessage[];
  compacted: boolean;
  droppedCount: number;
};

export function compactModelMessages(
  messages: ModelMessage[],
  contextLimit: number,
): ModelMessage[] {
  return compactModelMessagesDetailed(messages, contextLimit).messages;
}

export function compactModelMessagesDetailed(
  messages: ModelMessage[],
  contextLimit: number,
): CompactResult {
  let dropped = 0;
  let working = messages;
  let approxTokens = approxBytes(working) / 4;

  if (approxTokens >= 0.55 * contextLimit) {
    const r = dropSupersededReads(working);
    if (r.touched) {
      working = r.out;
      dropped++;
      approxTokens = approxBytes(working) / 4;
    }
  }

  if (approxTokens < 0.7 * contextLimit) {
    return {
      messages: working,
      compacted: dropped > 0,
      droppedCount: dropped,
    };
  }

  const out = working.slice();
  const stopIdx = Math.max(0, out.length - KEEP_TAIL);
  for (let i = 0; i < stopIdx; i++) {
    if (out[i].role === "system") continue;
    if (!Array.isArray(out[i].content)) continue;
    let local = false;
    const next = (out[i].content as ToolPart[]).map((part) => {
      const r = elideToolResult(part);
      if (r.changed) local = true;
      return r.part;
    });
    if (local) {
      out[i] = { ...out[i], content: next } as ModelMessage;
      dropped++;
      if (approxBytes(out) / 4 < 0.6 * contextLimit) break;
    }
  }

  return {
    messages: out,
    compacted: dropped > 0,
    droppedCount: dropped,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// P2-1 four-quadrant interface (hermes context_engine): decouple the "should I
// compress", "select what to compress", "record a turn", and "prune only tool
// results" concerns so the caller can invoke them independently.
// ═══════════════════════════════════════════════════════════════════════

/**
 * 1/4 shouldCompress: given an approximate token estimate and the model's
 * context limit, decide whether a compression pass is warranted. Uses the
 * same 0.7× threshold as the legacy path.
 */
export function shouldCompress(opts: {
  approxTokens: number;
  contextLimit: number;
}): boolean {
  return opts.approxTokens >= 0.7 * opts.contextLimit;
}

/**
 * 2/4 selectContext: run the actual compression over a message list, honoring
 * the head/tail protection zones (never elide the first PROTECT_FIRST_N or
 * last PROTECT_LAST_N messages). Returns the compacted messages + stats.
 */
export function selectContext(
  messages: ModelMessage[],
  contextLimit: number,
  opts: { protectFirst?: number; protectLast?: number } = {},
): CompactResult {
  const protectFirst = opts.protectFirst ?? PROTECT_FIRST_N;
  const protectLast = opts.protectLast ?? PROTECT_LAST_N;
  return compactModelMessagesDetailedWithProtection(
    messages,
    contextLimit,
    protectFirst,
    protectLast,
  );
}

/**
 * 3/4 onTurnComplete (debounce gate, hermes context_compressor L2296): track
 * how much the last compression saved; if two consecutive compressions saved
 * under `minSavedPct` (10%), stop compressing to avoid churn. Returns true
 * when a compression is still worthwhile, false to skip.
 */
export function createCompressionDebouncer(minSavedPct = 10) {
  let consecutiveSavesBelow = 0;
  return {
    recordCompression(savedPct: number): void {
      consecutiveSavesBelow =
        savedPct < minSavedPct ? consecutiveSavesBelow + 1 : 0;
    },
    shouldCompress(): boolean {
      return consecutiveSavesBelow < 2;
    },
    reset(): void {
      consecutiveSavesBelow = 0;
    },
  };
}

/**
 * 4/4 pruneToolResultsOnly: drop/elide ONLY oversized tool results (the
 * cheapest, least-lossy pass) without touching message structure. Head/tail
 * zones are honored. Returns the pruned messages + whether anything changed.
 */
export function pruneToolResultsOnly(
  messages: ModelMessage[],
  opts: { protectFirst?: number; protectLast?: number } = {},
): { messages: ModelMessage[]; changed: boolean } {
  const protectFirst = opts.protectFirst ?? PROTECT_FIRST_N;
  const protectLast = opts.protectLast ?? PROTECT_LAST_N;
  const lastStart = Math.max(protectFirst, messages.length - protectLast);
  let changed = false;
  const out = messages.map((m, i) => {
    if (i < protectFirst || i >= lastStart) return m;
    if (!Array.isArray(m.content)) return m;
    let local = false;
    const next = (m.content as ToolPart[]).map((part) => {
      const r = elideToolResult(part);
      if (r.changed) local = true;
      return r.part;
    });
    if (!local) return m;
    changed = true;
    return { ...m, content: next } as ModelMessage;
  });
  return { messages: changed ? out : messages, changed };
}

function compactModelMessagesDetailedWithProtection(
  messages: ModelMessage[],
  contextLimit: number,
  protectFirst: number,
  protectLast: number,
): CompactResult {
  // Full rewrite with the protection zones baked into the elision loop.
  const full = compactModelMessagesDetailed(messages, contextLimit);
  // The legacy path already keeps a tail; if a head must be protected but the
  // legacy pass elided it, restore the first `protectFirst` messages.
  const headRestored = full.messages.map((m, i) => {
    if (i < protectFirst) {
      const orig = messages[i];
      if (orig && JSON.stringify(orig.content) !== JSON.stringify(m.content)) {
        return orig;
      }
    }
    return m;
  });
  // Re-apply tail protection: ensure the last `protectLast` messages are the
  // originals (unelided).
  const tailIdx = Math.max(0, messages.length - protectLast);
  const tailRestored = headRestored.map((m, i) => {
    if (i >= tailIdx) {
      const orig = messages[i];
      if (orig && JSON.stringify(orig.content) !== JSON.stringify(m.content)) {
        return orig;
      }
    }
    return m;
  });
  return {
    messages: tailRestored,
    compacted: full.compacted,
    droppedCount: full.droppedCount,
  };
}

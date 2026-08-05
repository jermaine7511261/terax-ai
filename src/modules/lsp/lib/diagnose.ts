// AI-tool LSP diagnostics bridge (hermes-style post-write semantic lint).
//
// After an AI tool writes/edits a file, we tell the language server the file
// changed (full-text didSave, or didOpen when it never saw the file), then
// pull LSP 3.17 diagnostics and diff them against a baseline captured before
// the write. Only *new* diagnostics are surfaced, so a clean edit reports
// nothing.
//
// Every failure path is silent: a missing server, a server without a
// diagnosticProvider, a timeout, or a crash all degrade to "no data" and
// never block the write.

import { pathToFileUri } from "./uri";

export type LspDiagnostic = {
  line: number; // 0-based
  character: number;
  severity: number; // 1 = error, 2 = warning, 3 = info, 4 = hint
  message: string;
  source?: string;
};

const PULL_TIMEOUT_MS = 2_000;
const SETTLE_DELAY_MS = 300;

type Baseline = {
  diagnostics: LspDiagnostic[];
  /** Pre-edit full content lines, used to shift baseline line numbers. */
  beforeLines: string[];
};

const baselineByPath = new Map<string, Baseline>();

function normKey(path: string): string {
  return path.replace(/\\/g, "/");
}

async function pullCurrentDiagnostics(path: string): Promise<LspDiagnostic[]> {
  const { sessionsForPath } = await import("./sessionManager");
  const managed = sessionsForPath(path);
  if (managed.length === 0) return [];
  const client = managed[0].client;
  if (!client.ready || !client.capabilities?.diagnosticProvider) return [];

  const uri = pathToFileUri(path);
  const result = (await Promise.race([
    client.textDocumentDiagnostic({
      textDocument: { uri },
      previousResultId: null,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("lsp diagnostic timeout")), PULL_TIMEOUT_MS),
    ),
  ]).catch(() => null)) as
    | { items?: { range: { start: { line: number; character: number } }; message: string; severity?: number; source?: string }[] }
    | null;

  return (result?.items ?? []).map((d) => ({
    line: d.range.start.line,
    character: d.range.start.character,
    severity: d.severity ?? 3,
    message: d.message,
    source: d.source,
  }));
}

/** Notify the server that an AI tool wrote `text` to `path`. */
async function notifyFileChanged(path: string, text: string): Promise<void> {
  const { sessionsForPath } = await import("./sessionManager");
  const managed = sessionsForPath(path);
  if (managed.length === 0) return;
  const client = managed[0].client;
  if (!client.ready) return;
  const uri = pathToFileUri(path);
  const languageId = languageIdForExtension(extOf(path));
  try {
    if (managed[0].refs.has(uri)) {
      client.textDocumentDidSaveWithText(uri, text);
    } else {
      client.textDocumentDidOpenFull(uri, text, languageId);
      client.textDocumentDidSaveWithText(uri, text);
    }
  } catch {
    // notify is fire-and-forget; nothing to recover.
  }
}

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

const EXT_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
  vue: "vue",
  svelte: "svelte",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  java: "java",
  cs: "csharp",
  rb: "ruby",
  yml: "yaml",
  yaml: "yaml",
  sh: "shellscript",
  bash: "shellscript",
};

function languageIdForExtension(ext: string): string {
  return EXT_LANGUAGE[ext] ?? "plaintext";
}

function sameDiagnostic(a: LspDiagnostic, b: LspDiagnostic): boolean {
  return (
    a.line === b.line &&
    a.character === b.character &&
    a.message === b.message &&
    (a.source ?? "") === (b.source ?? "")
  );
}

// LCS row length cap: beyond this we bail out of line-shifting (a no-op map)
// to keep the diff O(n*m) memory bounded for very large files. Diagnostics
// are best-effort; a missing shift only risks a phantom "new" diagnostic on
// pathological giant files, never a missed write.
const LCS_MAX_LINES = 1500;

/**
 * Compute a mapping from pre-edit line index to post-edit line index for the
 * lines that survived the edit. Modeled on hermes `range_shift.py`:
 * insertions shift lines below down; deletions collapse them up. Used to
 * translate the pre-edit diagnostic baseline so that a mid-file insertion
 * does not re-report pre-existing errors below the edit point as "new".
 *
 * Returns a Map<beforeLine, afterLine> for matched lines. Lines that were
 * deleted are omitted; the caller maps them to the nearest surviving line.
 * Returns an empty map (caller falls back to identity) when either side is
 * too large to diff cheaply, or when there is no shared content.
 */
export function buildLineShift(
  before: string[],
  after: string[],
): Map<number, number> {
  const n = before.length;
  const m = after.length;
  if (n > LCS_MAX_LINES || m > LCS_MAX_LINES || n === 0 || m === 0) {
    return new Map();
  }
  // Classic LCS DP over lines, row-major. Keep only the previous row for the
  // score; reconstruct the aligned pairs by a second pass with a memo of the
  // "optimal next step" per cell is avoided by storing backpointers in a
  // compact Uint8 grid (down=0, right=1, diagonal=2).
  const width = m + 1;
  const height = n + 1;
  const dir: Uint8Array = new Uint8Array(height * width);
  let prev = new Uint16Array(width);
  let curr = new Uint16Array(width);
  for (let i = 1; i <= n; i++) {
    const beforeLine = before[i - 1];
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1];
      const up = prev[j];
      const left = curr[j - 1];
      if (beforeLine === after[j - 1] && diag + 1 >= up && diag + 1 >= left) {
        curr[j] = diag + 1;
        dir[i * width + j] = 2;
      } else if (up >= left) {
        curr[j] = up;
        dir[i * width + j] = 0; // up (consume before line, it was deleted)
      } else {
        curr[j] = left;
        dir[i * width + j] = 1; // left (consume after line, it was inserted)
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  // Reconstruct matched pairs (beforeIdx -> afterIdx).
  const map = new Map<number, number>();
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const d = dir[i * width + j];
    if (d === 2) {
      map.set(i - 1, j - 1);
      i -= 1;
      j -= 1;
    } else if (d === 0) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return map;
}

/**
 * Translate a pre-edit diagnostic's line index to the post-edit coordinate
 * using the LCS match map. Deleted lines map to the nearest surviving line
 * below them (best-effort); lines past the last match map by the accumulated
 * offset so a tail insertion still shifts correctly.
 */
function shiftLine(
  line: number,
  map: Map<number, number>,
): number {
  if (map.size === 0) return line;
  // Find the largest matched before-line <= `line`.
  let bestBefore = -1;
  let bestAfter = -1;
  for (const [b, a] of map) {
    if (b <= line && b > bestBefore) {
      bestBefore = b;
      bestAfter = a;
    }
  }
  if (bestBefore === -1) {
    // Everything above this line was deleted; map to the first surviving line.
    let firstAfter = -1;
    for (const a of map.values()) {
      if (firstAfter === -1 || a < firstAfter) firstAfter = a;
    }
    return firstAfter === -1 ? 0 : firstAfter;
  }
  return bestAfter + (line - bestBefore);
}

function shiftDiagnostics(
  diags: LspDiagnostic[],
  beforeLines: string[],
  after: string[],
): LspDiagnostic[] {
  const map = buildLineShift(beforeLines, after);
  if (map.size === 0 && beforeLines.length === after.length) return diags;
  return diags.map((d) => ({
    ...d,
    line: shiftLine(d.line, map),
  }));
}

/**
 * Capture the pre-edit baseline for `path`. Call before the write; the
 * returned function is a no-op when no live LSP session covers the file.
 * Also snapshots the pre-edit content lines so `newDiagnosticsAfterWrite` can
 * shift baseline line numbers across a mid-file insertion/deletion.
 */
export async function captureBaseline(path: string): Promise<() => void> {
  const diags = await pullCurrentDiagnostics(path);
  if (diags.length === 0) return () => {};
  let beforeLines: string[] = [];
  try {
    const { native } = await import("@/modules/ai/lib/native");
    const r = await native.readFile(path);
    if (r.kind === "text") {
      beforeLines = r.content.split("\n");
    }
  } catch {
    // Best-effort; empty beforeLines disables shifting (identity fallback).
  }
  baselineByPath.set(normKey(path), { diagnostics: diags, beforeLines });
  return () => {
    baselineByPath.delete(normKey(path));
  };
}

/**
 * After an AI tool wrote `text` to `path`, return a human-readable summary of
 * diagnostics introduced by this edit (empty string when none, or when LSP is
 * unavailable). Baseline line numbers are shifted by the edit diff first, so
 * a pre-existing error below a mid-file insertion is not re-reported.
 */
export async function newDiagnosticsAfterWrite(
  path: string,
  text: string,
): Promise<{ summary: string; count: number }> {
  await notifyFileChanged(path, text);
  await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));
  const after = await pullCurrentDiagnostics(path);
  if (after.length === 0) return { summary: "", count: 0 };

  const key = normKey(path);
  const baseline = baselineByPath.get(key);
  baselineByPath.delete(key);
  const shifted = baseline
    ? shiftDiagnostics(baseline.diagnostics, baseline.beforeLines, text.split("\n"))
    : [];

  const added = after.filter(
    (d) => !shifted.some((b) => sameDiagnostic(b, d)),
  );
  if (added.length === 0) return { summary: "", count: 0 };

  const label = (s: number) =>
    s === 1 ? "ERROR" : s === 2 ? "WARNING" : s === 3 ? "INFO" : "HINT";
  const lines = added.map(
    (d) =>
      `${label(d.severity)} [${d.line + 1}:${d.character + 1}] ${d.message}${d.source ? ` (${d.source})` : ""}`,
  );
  return { summary: lines.join("\n"), count: added.length };
}

/** Shared tool-result helper: attaches `lsp_diagnostics` when non-empty. */
export function withLspDiagnostics<T extends Record<string, unknown>>(
  result: T,
  lsp: { summary: string; count: number },
): T & { lsp_diagnostics?: string } {
  if (lsp.summary) {
    return { ...result, lsp_diagnostics: lsp.summary } as T & {
      lsp_diagnostics?: string;
    };
  }
  return result;
}

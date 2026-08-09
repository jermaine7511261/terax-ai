import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkWritableCanonical } from "../lib/security";
import { newQueuedEditId, usePlanStore } from "../store/planStore";
import {
  captureBaseline,
  newDiagnosticsAfterWrite,
  withLspDiagnostics,
} from "@/modules/lsp/lib/diagnose";
import { resolvePath, type ToolContext } from "./context";

type EditResult =
  | { ok: true; replacements: number; bytesWritten: number; path: string }
  | { error: string; path: string };

type PatchFile = {
  /** Path from the diff header (`+++`/`---` b/ path), normalized to repo-relative. */
  path: string;
  hunks: PatchHunk[];
};

type PatchHunk = {
  /** Original-file line range (1-based). */
  origStart: number;
  origLines: number;
  newStart: number;
  newLines: number;
  lines: string[]; // each with leading ' ', '+', '-' or '\' (no-newline marker)
};

/**
 * Parse a unified diff into per-file hunks. Handles `diff --git`/`---`/`+++`
 * headers and `@@ -a,b +c,d @@` hunks. Tolerates missing line counts
 * (`@@ -5 +5 @@`). Returns files in diff order.
 */
function parseUnifiedDiff(text: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let hunk: PatchHunk | null = null;

  const finalizeHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  const finalizeFile = () => {
    finalizeHunk();
    if (current && current.hunks.length > 0) files.push(current);
    current = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ") || line.startsWith("Index: ")) {
      finalizeFile();
      continue;
    }
    if (line.startsWith("--- ")) {
      finalizeFile();
      // The new-file path appears on the +++ line; capture both here.
      current = { path: "", hunks: [] };
      const p = line.slice(4).replace(/^[ab]\//, "");
      if (p !== "/dev/null") current.path = p;
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (!current) current = { path: "", hunks: [] };
      const p = line.slice(4).replace(/^[ab]\//, "");
      if (p !== "/dev/null") current.path = p;
      continue;
    }
    if (line.startsWith("@@ ")) {
      finalizeHunk();
      if (!current) current = { path: "", hunks: [] };
      const m = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        hunk = {
          origStart: Number(m[1]),
          origLines: m[2] ? Number(m[2]) : 1,
          newStart: Number(m[3]),
          newLines: m[4] ? Number(m[4]) : 1,
          lines: [],
        };
      } else {
        // Malformed hunk header — reset to avoid misapplying.
        hunk = null;
      }
      continue;
    }
    if (hunk && current) {
      // Context line, addition, or removal.
      if (line.startsWith("\\") || line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
        hunk.lines.push(line);
      }
      // Anything else (e.g. an unterminated hunk) is ignored for safety.
    }
  }
  finalizeFile();
  return files;
}

/** Apply parsed hunks to a file body. Returns the new content or a description of what failed. */
function applyHunks(
  body: string,
  hunks: PatchHunk[],
): { ok: true; content: string } | { ok: false; error: string } {
  // Work on a line array; track applied ranges in reverse to keep offsets valid.
  let lines = body.split("\n");
  // Sort hunks by original start, apply bottom-up so earlier offsets stay valid.
  const ordered = [...hunks].sort((a, b) => b.origStart - a.origStart);
  for (const hunk of ordered) {
    // Find the anchor: the first context line (' ') or '+' line must exist at
    // origStart in the current (already-edited-below) array. Because we edit
    // bottom-up, lines above origStart are untouched, so we can index directly.
    const anchorIdx = hunk.origStart - 1; // origStart is 1-based
    if (anchorIdx < 0 || anchorIdx > lines.length) {
      return { ok: false, error: `hunk anchor out of range (line ${hunk.origStart})` };
    }
    // Verify the context/removal lines at the anchor match the current content
    // before applying — this is the "one hunk misses ⇒ abort whole patch" rule.
    const origText = hunk.lines.filter((l) => l.startsWith(" ") || l.startsWith("-"));
    const expected = origText.map((l) => l.slice(1));
    // Context matching is fuzzy to tolerate the file already having edits; but a
    // strict "no newline" mismatch aborts. Compare against a sliding window.
    const matched = matchWindow(lines, anchorIdx, expected);
    if (!matched) {
      return {
        ok: false,
        error: `hunk at line ${hunk.origStart} does not match file context`,
      };
    }
    // Replace the matched region with the non-removal lines.
    const replacement = hunk.lines
      .filter((l) => !l.startsWith("-") && !l.startsWith("\\"))
      .map((l) => l.slice(1));
    lines = [
      ...lines.slice(0, matched.start),
      ...replacement,
      ...lines.slice(matched.end),
    ];
  }
  return { ok: true, content: lines.join("\n") };
}

function matchWindow(
  lines: string[],
  anchorIdx: number,
  expected: string[],
): { start: number; end: number } | null {
  // expected is the list of context/removal lines that must be present. We allow
  // a small lookaround around anchorIdx (up to expected length) to find them.
  const start = Math.max(0, anchorIdx - expected.length);
  const end = Math.min(lines.length, anchorIdx + expected.length + 1);
  for (let i = start; i + expected.length <= end; i++) {
    let ok = true;
    for (let j = 0; j < expected.length; j++) {
      if (lines[i + j] !== expected[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: i, end: i + expected.length };
  }
  return null;
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

async function applyEdits(
  abs: string,
  edits: { old_string: string; new_string: string; replace_all?: boolean }[],
  kind: "edit" | "multi_edit",
  readCache: Map<string, { size: number; hash: number }>,
): Promise<EditResult> {
  const r = await native.readFile(abs);
  if (r.kind === "binary")
    return { error: "binary file refused", path: abs };
  if (r.kind === "toolarge")
    return { error: `file too large (${r.size} bytes)`, path: abs };

  const original = r.content;
  // Optimistic concurrency: record the disk mtime at read so the write can
  // refuse if another writer changed the file in between (prevents the
  // "concurrent edit to the same file loses the first" data-loss).
  const expectedMtime = "mtime" in r && typeof r.mtime === "number" ? r.mtime : 0;
  let content = original;
  let totalReplacements = 0;

  for (const e of edits) {
    if (e.old_string === e.new_string) {
      return {
        error: "old_string and new_string are identical",
        path: abs,
      };
    }
    if (e.old_string.length === 0) {
      return { error: "old_string cannot be empty", path: abs };
    }
    if (e.replace_all) {
      const before = content;
      content = content.split(e.old_string).join(e.new_string);
      const occurrences =
        (before.length - content.length) /
          (e.old_string.length - e.new_string.length || 1) || 0;
      // Recover count via direct search to avoid divide-by-zero edge cases.
      let n = 0;
      for (
        let i = before.indexOf(e.old_string);
        i !== -1;
        i = before.indexOf(e.old_string, i + e.old_string.length)
      ) {
        n++;
      }
      if (n === 0) {
        return {
          error: `old_string not found: ${JSON.stringify(e.old_string.slice(0, 80))}`,
          path: abs,
        };
      }
      totalReplacements += n;
      void occurrences;
    } else {
      const first = content.indexOf(e.old_string);
      if (first === -1) {
        return {
          error: `old_string not found: ${JSON.stringify(e.old_string.slice(0, 80))}`,
          path: abs,
        };
      }
      const second = content.indexOf(e.old_string, first + 1);
      if (second !== -1) {
        return {
          error:
            "old_string is not unique. Provide more surrounding context, or set replace_all=true.",
          path: abs,
        };
      }
      content =
        content.slice(0, first) +
        e.new_string +
        content.slice(first + e.old_string.length);
      totalReplacements += 1;
    }
  }

  if (usePlanStore.getState().active) {
    usePlanStore.getState().enqueue({
      id: newQueuedEditId(),
      kind,
      path: abs,
      originalContent: original,
      proposedContent: content,
      isNewFile: false,
    });
    return {
      ok: true,
      replacements: totalReplacements,
      bytesWritten: content.length,
      path: abs,
    };
  }

  const releaseBaseline = await captureBaseline(abs);
  try {
    await native.writeFile(abs, content, { expectedMtime });
    readCache.set(abs, { size: content.length, hash: djb2(content) });
    const lsp = await newDiagnosticsAfterWrite(abs, content);
    return withLspDiagnostics(
      {
        ok: true as const,
        replacements: totalReplacements,
        bytesWritten: content.length,
        path: abs,
      },
      lsp,
    );
  } catch (err) {
    const msg = String(err);
    return {
      error: msg.includes("concurrent modification")
        ? `concurrent modification detected for ${abs}; re-read the file and retry`
        : msg,
      path: abs,
    };
  } finally {
    releaseBaseline();
  }
}

export function buildEditTools(ctx: ToolContext) {
  return {
    edit: tool({
      description:
        "Replace an exact string in a file. Requires read_file on this path first in the current session — this prevents blind edits. `old_string` must be unique in the file unless `replace_all: true`. Asks for user approval before writing.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z
          .string()
          .describe("Exact substring to replace. Must be unique unless replace_all."),
        new_string: z.string().describe("Replacement substring."),
        replace_all: z.boolean().optional(),
      }),
      needsApproval: true,
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "must call read_file on this path first (read-before-edit invariant).",
            path: abs,
          };
        }
        return applyEdits(
          abs,
          [{ old_string, new_string, replace_all }],
          "edit",
          ctx.readCache,
        );
      },
    }),

    multi_edit: tool({
      description:
        "Apply several exact-string replacements to a single file atomically. Each edit is applied in order to the running buffer; if any edit's old_string is missing or non-unique, the whole batch aborts before writing. Requires prior read_file on the path. Asks for user approval before writing.",
      inputSchema: z.object({
        path: z.string(),
        edits: z
          .array(
            z.object({
              old_string: z.string(),
              new_string: z.string(),
              replace_all: z.boolean().optional(),
            }),
          )
          .min(1),
      }),
      needsApproval: true,
      execute: async ({ path, edits }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "must call read_file on this path first (read-before-edit invariant).",
            path: abs,
          };
        }
        return applyEdits(abs, edits, "multi_edit", ctx.readCache);
      },
    }),

    apply_patch: tool({
      description:
        "Apply a unified diff (git-style) to one or more files atomically. The diff can target multiple files; each file must have been read first via read_file. Every hunk must match its file's current context — if any hunk fails to apply, the whole patch is rejected and nothing is written. Supports context/+/− lines and multiple hunks per file. Asks for user approval before writing.",
      inputSchema: z.object({
        diff: z
          .string()
          .describe(
            "A unified diff (output of `git diff`/`diff -u`). Contains ---/+++ headers and @@ hunks.",
          ),
        base_path: z
          .string()
          .optional()
          .describe(
            "Directory the diff paths are relative to. Defaults to the active terminal cwd.",
          ),
      }),
      needsApproval: true,
      execute: async ({ diff, base_path }) => {
        const files = parseUnifiedDiff(diff);
        if (files.length === 0) {
          return { error: "no parseable hunks found in diff", path: "" };
        }
        const base = base_path ? resolvePath(base_path, ctx.getCwd()) : ctx.getCwd();
        if (!base) {
          return {
            error:
              "cannot resolve relative diff paths: no base_path and no active terminal cwd. Pass an absolute base_path.",
            path: "",
          };
        }
        const results: {
          path: string;
          ok: boolean;
          bytesWritten?: number;
          error?: string;
        }[] = [];
        // Phase 1: read + compute proposed content for every file; any failure aborts all.
        const prepared: {
          abs: string;
          original: string;
          proposed: string;
        }[] = [];
        for (const f of files) {
          const absPath = resolvePath(f.path, base);
          const safety = await checkWritableCanonical(absPath, native.canonicalize);
          if (!safety.ok) {
            return { error: safety.reason, path: f.path };
          }
          const abs = safety.canonical;
          if (!ctx.readCache.has(abs)) {
            return {
              error: `must call read_file on "${f.path}" first (read-before-edit invariant).`,
              path: f.path,
            };
          }
          const r = await native.readFile(abs);
          if (r.kind === "binary")
            return { error: "binary file refused", path: f.path };
          if (r.kind === "toolarge")
            return { error: `file too large (${r.size} bytes)`, path: f.path };
          const applied = applyHunks(r.content, f.hunks);
          if (!applied.ok) {
            return { error: applied.error, path: f.path };
          }
          prepared.push({ abs, original: r.content, proposed: applied.content });
        }
        // Phase 2: plan-mode enqueue or write all files.
        for (const p of prepared) {
          if (usePlanStore.getState().active) {
            usePlanStore.getState().enqueue({
              id: newQueuedEditId(),
              kind: "apply_patch",
              path: p.abs,
              originalContent: p.original,
              proposedContent: p.proposed,
              isNewFile: false,
            });
            results.push({ path: p.abs, ok: true, bytesWritten: p.proposed.length });
            continue;
          }
          const releaseBaseline = await captureBaseline(p.abs);
          try {
            // Optimistic concurrency: re-stat before write to capture the
            // current mtime, so a concurrent writer won't be silently
            // clobbered (the write refuses on mismatch).
            const cur = await native.readFile(p.abs);
            const expectedMtime =
              "mtime" in cur && typeof cur.mtime === "number" ? cur.mtime : 0;
            await native.writeFile(p.abs, p.proposed, { expectedMtime });
            ctx.readCache.set(p.abs, {
              size: p.proposed.length,
              hash: djb2(p.proposed),
            });
            const lsp = await newDiagnosticsAfterWrite(p.abs, p.proposed);
            results.push(
              withLspDiagnostics(
                { path: p.abs, ok: true, bytesWritten: p.proposed.length },
                lsp,
              ),
            );
          } catch (err) {
            releaseBaseline();
            const msg = String(err);
            results.push({
              path: p.abs,
              ok: false,
              error: msg.includes("concurrent modification")
                ? `concurrent modification detected for ${p.abs}; re-read and retry`
                : msg,
            });
          }
        }
        return { files: results };
      },
    }),
  } as const;
}

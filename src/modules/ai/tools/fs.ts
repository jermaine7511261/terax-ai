import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import {
  checkReadableCanonical,
  checkWritableCanonical,
} from "../lib/security";
import { newQueuedEditId, usePlanStore } from "../store/planStore";
import {
  captureBaseline,
  newDiagnosticsAfterWrite,
  withLspDiagnostics,
} from "@/modules/lsp/lib/diagnose";
import { resolvePath, type ToolContext } from "./context";

const READ_BYTE_CAP = 25 * 1024;
const READ_LINE_CAP = 2000;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function buildFsTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description:
        "Read a UTF-8 text file. Defaults to the first 2000 lines (capped at 25KB). Pass `offset`/`limit` for line-based windowing of large files. Refuses binary, oversized, or sensitive files (.env, keys, credentials). If you call this on the same path twice in a session without edits in between, the second call returns `unchanged: true` instead of re-emitting the content — re-read the prior tool result.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path, or relative to the active terminal cwd."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("0-based start line. Default 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe("Max lines to return. Default 2000."),
      }),
      execute: async ({ path, offset, limit }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const r = await native.readFile(abs);
          if (r.kind === "binary")
            return { error: "binary file refused", path: abs, size: r.size };
          if (r.kind === "toolarge")
            return {
              error: `file too large (${r.size} bytes, limit ${r.limit})`,
              path: abs,
            };

          const hash = djb2(r.content);
          const isFullRead = offset === undefined && limit === undefined;
          const prior = ctx.readCache.get(abs);
          if (isFullRead && prior && prior.size === r.size && prior.hash === hash) {
            return { path: abs, unchanged: true, size: r.size };
          }
          ctx.readCache.set(abs, { size: r.size, hash });

          if (isFullRead) {
            const lines = r.content.split("\n");
            const sliceEnd = Math.min(lines.length, READ_LINE_CAP);
            let content = lines.slice(0, sliceEnd).join("\n");
            let truncated = sliceEnd < lines.length;
            if (content.length > READ_BYTE_CAP) {
              content = content.slice(0, READ_BYTE_CAP);
              truncated = true;
            }
            return {
              path: abs,
              content,
              size: r.size,
              total_lines: lines.length,
              ...(truncated
                ? { truncated: true, hint: "call read_file with offset to continue" }
                : {}),
            };
          }

          const lines = r.content.split("\n");
          const start = offset ?? 0;
          const requested = limit ?? READ_LINE_CAP;
          const end = Math.min(lines.length, start + requested);
          let content = lines.slice(start, end).join("\n");
          let truncated = end < lines.length;
          if (content.length > READ_BYTE_CAP) {
            content = content.slice(0, READ_BYTE_CAP);
            truncated = true;
          }
          return {
            path: abs,
            content,
            size: r.size,
            total_lines: lines.length,
            start_line: start,
            end_line: end,
            ...(truncated ? { truncated: true } : {}),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    list_directory: tool({
      description:
        "List immediate entries (files + directories) in a directory. Hidden entries are omitted.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path, or relative to the active terminal cwd."),
      }),
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const entries = await native.readDir(abs);
          return {
            path: abs,
            entries: entries.map((e) => ({ name: e.name, kind: e.kind })),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    write_file: tool({
      description:
        "Create or overwrite a file with the given content. Always asks the user before running. Prefer `edit` / `multi_edit` for in-place changes — only use `write_file` for creating a brand-new file or fully replacing a tiny one.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      needsApproval: true,
      execute: async ({ path, content }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;

        if (usePlanStore.getState().active) {
          let original = "";
          let isNewFile = false;
          try {
            const r = await native.readFile(abs);
            if (r.kind === "text") original = r.content;
          } catch {
            isNewFile = true;
          }
          usePlanStore.getState().enqueue({
            id: newQueuedEditId(),
            kind: "write_file",
            path: abs,
            originalContent: original,
            proposedContent: content,
            isNewFile,
          });
          return {
            path: abs,
            queued_for_plan_review: true,
            ok: true,
          };
        }

        // Best-effort LSP semantic lint: baseline before, diff after. Any
        // failure degrades to "no data" and never blocks the write.
        const releaseBaseline = await captureBaseline(abs);
        try {
          await native.writeFile(abs, content);
          ctx.readCache.set(abs, { size: content.length, hash: djb2(content) });
          const lsp = await newDiagnosticsAfterWrite(abs, content);
          return withLspDiagnostics(
            { path: abs, bytesWritten: content.length, ok: true },
            lsp,
          );
        } catch (e) {
          return { error: String(e), path: abs };
        } finally {
          releaseBaseline();
        }
      },
    }),

    create_docx: tool({
      description:
        "Create a .docx Word document from markdown-ish lines and write it to `path`. Each element of `lines` is one block: `# ` / `## ` / `### ` prefixes make headings, `| a | b |` makes a table row (consecutive rows merge into one table), `- ` makes a bullet, anything else is a paragraph. Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute output path, or relative to the active terminal cwd. Must end in .docx."),
        lines: z
          .array(z.string())
          .describe("Document blocks (headings, table rows, bullets, paragraphs)."),
      }),
      needsApproval: true,
      execute: async ({ path, lines }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const bytesWritten = await native.createDocx(abs, lines);
          ctx.readCache.set(abs, { size: bytesWritten, hash: djb2(lines.join("\n")) });
          return { path: abs, bytesWritten, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_xlsx: tool({
      description:
        "Create a .xlsx Excel workbook from a 2D grid and write it to `path`. Each `rows` element is a row; each cell is a string (numbers are written as text unless they parse). Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute output path, or relative to the active terminal cwd. Must end in .xlsx."),
        rows: z
          .array(z.array(z.string()))
          .describe("Grid of cell values; row-major, one inner array per row."),
      }),
      needsApproval: true,
      execute: async ({ path, rows }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const bytesWritten = await native.createXlsx(abs, rows);
          ctx.readCache.set(abs, {
            size: bytesWritten,
            hash: djb2(rows.map((r) => r.join("\t")).join("\n")),
          });
          return { path: abs, bytesWritten, rows: rows.length, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_pptx: tool({
      description:
        "Create a .pptx PowerPoint deck from slide strings and write it to `path`. Each `slides` element is one slide; `\\n` inside a slide splits it into lines. Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute output path, or relative to the active terminal cwd. Must end in .pptx."),
        slides: z
          .array(z.string())
          .describe("Slide contents, one string per slide (newlines become slide lines)."),
      }),
      needsApproval: true,
      execute: async ({ path, slides }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const bytesWritten = await native.createPptx(abs, slides);
          ctx.readCache.set(abs, { size: bytesWritten, hash: djb2(slides.join("\n")) });
          return { path: abs, bytesWritten, slides: slides.length, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

        merge_pdf: tool({
      description:
        "Merge multiple PDF files into one, in the given order. Writes the combined document to `output`. Each input is validated (readable, non-secret, ≤50MB) and the output is validated (writable, inside the workspace). Always asks the user before running.",
      inputSchema: z.object({
        files: z
          .array(z.string())
          .describe("Input PDF paths, in merge order (absolute, or relative to the active terminal cwd)."),
        output: z
          .string()
          .describe("Destination PDF path (absolute, or relative to the active terminal cwd). Must end in .pdf."),
      }),
      needsApproval: true,
      execute: async ({ files, output }) => {
        const outAbs = resolvePath(output, ctx.getCwd());
        const outSafety = await checkWritableCanonical(outAbs, native.canonicalize);
        if (!outSafety.ok) return { error: outSafety.reason, path: outAbs };
        const out = outSafety.canonical;
        const absFiles: string[] = [];
        for (const f of files) {
          const reqPath = resolvePath(f, ctx.getCwd());
          const safety = await checkReadableCanonical(reqPath, native.canonicalize);
          if (!safety.ok) return { error: safety.reason, path: reqPath };
          absFiles.push(safety.canonical);
        }
        if (absFiles.length === 0) return { error: "at least one input PDF is required", output: out };
        try {
          const bytesWritten = await native.pdfMerge(absFiles, out);
          ctx.readCache.set(out, {
            size: bytesWritten,
            hash: djb2(absFiles.join("\n")),
          });
          return { output: out, pagesMerged: absFiles.length, bytesWritten, ok: true };
        } catch (e) {
          return { error: String(e), output: out };
        }
      },
    }),

    encrypt_pdf: tool({
      description:
        "Encrypt a PDF with AES-256. `output` may equal `input` to replace in place. Requires at least one of `user_password` (what a reader types to open) or `owner_password` (what controls permission changes); if only one is given the other defaults to it. Always asks the user before running.",
      inputSchema: z.object({
        input: z
          .string()
          .describe("Source PDF path (absolute, or relative to the active terminal cwd)."),
        output: z
          .string()
          .describe("Destination PDF path (absolute, or relative to the active terminal cwd). May equal `input`."),
        user_password: z
          .string()
          .optional()
          .describe("Password required to open the document."),
        owner_password: z
          .string()
          .optional()
          .describe("Password that controls permission changes; defaults to `user_password`."),
      }),
      needsApproval: true,
      execute: async ({ input, output, user_password, owner_password }) => {
        const inAbs = resolvePath(input, ctx.getCwd());
        const inSafety = await checkReadableCanonical(inAbs, native.canonicalize);
        if (!inSafety.ok) return { error: inSafety.reason, path: inAbs };
        const src = inSafety.canonical;
        const outAbs = resolvePath(output, ctx.getCwd());
        const outSafety = await checkWritableCanonical(outAbs, native.canonicalize);
        if (!outSafety.ok) return { error: outSafety.reason, path: outAbs };
        const out = outSafety.canonical;
        if (!user_password && !owner_password) {
          return { error: "at least one of user_password / owner_password is required", input: src };
        }
        try {
          const bytesWritten = await native.pdfEncrypt(src, out, user_password, owner_password);
          return { output: out, bytesWritten, ok: true };
        } catch (e) {
          return { error: String(e), input: src, output: out };
        }
      },
    }),

    create_pdf: tool({
      description:
        "Create a text PDF (A4) from markdown-ish lines and write it to `path`. `# `/`## `/`### ` make bold headings, `- ` makes bullets, everything else is a paragraph; long lines wrap and pages break automatically. Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute output path, or relative to the active terminal cwd. Must end in .pdf."),
        lines: z
          .array(z.string())
          .describe("Document lines (headings, bullets, paragraphs)."),
      }),
      needsApproval: true,
      execute: async ({ path, lines }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const bytesWritten = await native.createPdf(abs, lines);
          ctx.readCache.set(abs, { size: bytesWritten, hash: djb2(lines.join("\n")) });
          return { path: abs, bytesWritten, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    edit_docx: tool({
      description:
        "Replace text in an existing .docx in place. Each `replacements` entry is a [find, replace] pair applied to the document's text runs; everything else in the file is preserved. Returns the number of replacements made. Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path to the .docx, or relative to the active terminal cwd."),
        replacements: z
          .array(z.array(z.string()).length(2))
          .describe("[find, replace] pairs, e.g. [[\"{{NAME}}\", \"World\"]]."),
      }),
      needsApproval: true,
      execute: async ({ path, replacements }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const replaced = await native.editDocx(abs, replacements);
          return { path: abs, replaced, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    edit_pptx: tool({
      description:
        "Replace text in an existing .pptx in place. Each `replacements` entry is a [find, replace] pair applied across all slides' text; everything else is preserved. Returns the number of replacements made. Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path to the .pptx, or relative to the active terminal cwd."),
        replacements: z
          .array(z.array(z.string()).length(2))
          .describe("[find, replace] pairs."),
      }),
      needsApproval: true,
      execute: async ({ path, replacements }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const replaced = await native.editPptx(abs, replacements);
          return { path: abs, replaced, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    edit_xlsx: tool({
      description:
        "Set cells in an existing .xlsx in place. Each `cells` entry has `sheet` (0-based), `cell` (e.g. \"B2\"), `kind` (\"string\" | \"number\" | \"boolean\"), and `value`. Existing cell styles are preserved and everything else in the workbook is untouched. Returns the number of cells set. Always asks the user before running.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path to the .xlsx, or relative to the active terminal cwd."),
        cells: z.array(
          z.object({
            sheet: z.number().int().min(0).describe("0-based sheet index."),
            cell: z.string().describe("Cell reference, e.g. \"B2\"."),
            kind: z
              .enum(["string", "number", "boolean"])
              .optional()
              .describe("Value type; defaults to string."),
            value: z.string().describe("Value (number/boolean parsed when kind says so)."),
          }),
        ),
      }),
      needsApproval: true,
      execute: async ({ path, cells }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const set = await native.editXlsx(abs, cells);
          return { path: abs, cellsSet: set, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_directory: tool({      description:
        "Create a directory (and any missing parents). Always asks the user before running.",
      inputSchema: z.object({
        path: z.string(),
      }),
      needsApproval: true,
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (usePlanStore.getState().active) {
          usePlanStore.getState().enqueue({
            id: newQueuedEditId(),
            kind: "create_directory",
            path: abs,
            originalContent: "",
            proposedContent: "",
            isNewFile: true,
            description: "Create directory",
          });
          return { path: abs, queued_for_plan_review: true, ok: true };
        }
        try {
          await native.createDir(abs);
          return { path: abs, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    delete_file: tool({
      description:
        "Delete a file (or an empty directory). Recursively deletes a non-empty directory, so be careful. Always asks the user before running. Never use bash_run rm for this — use this tool so the path safety checks apply.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute path, or relative to the active terminal cwd."),
      }),
      needsApproval: true,
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          await native.deleteFile(abs);
          return { path: abs, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    rename_file: tool({
      description:
        "Rename or move a file/directory to a new path. Refuses to overwrite an existing target. Always asks the user before running.",
      inputSchema: z.object({
        from: z
          .string()
          .describe("Current path (absolute, or relative to the active terminal cwd)."),
        to: z
          .string()
          .describe("New path (absolute, or relative to the active terminal cwd)."),
      }),
      needsApproval: true,
      execute: async ({ from, to }) => {
        const fromAbs = resolvePath(from, ctx.getCwd());
        const toAbs = resolvePath(to, ctx.getCwd());
        const safety = await checkWritableCanonical(fromAbs, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: fromAbs };
        const src = safety.canonical;
        // The destination must also be a writable, non-secret location.
        const destSafety = await checkWritableCanonical(toAbs, native.canonicalize);
        if (!destSafety.ok) return { error: destSafety.reason, path: toAbs };
        const dest = destSafety.canonical;
        try {
          await native.renameFile(src, dest);
          return { from: src, to: dest, ok: true };
        } catch (e) {
          return { error: String(e), from: src, to: dest };
        }
      },
    }),
  } as const;
}

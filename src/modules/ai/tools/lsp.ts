import { tool } from "ai";
import { z } from "zod";
import { pathToFileUri } from "@/modules/lsp/lib/uri";
import { sessionsForPath } from "@/modules/lsp/lib/sessionManager";
import type { ToolContext } from "./context";

/** Normalize LSP definition results (Location | Location[] | LocationLink[])
 *  into `{ uri, line, character }` entries. */
function normalizeLocations(defs: unknown): { uri: string; line: number; character: number }[] {
  const list = Array.isArray(defs) ? defs : defs != null ? [defs] : [];
  const out: { uri: string; line: number; character: number }[] = [];
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const o = d as Record<string, unknown>;
    const uri = typeof o.uri === "string" ? o.uri : typeof o.targetUri === "string" ? (o.targetUri as string) : "";
    const range =
      (o.range as { start?: { line?: unknown; character?: unknown } } | undefined) ??
      (o.targetSelectionRange as { start?: { line?: unknown; character?: unknown } } | undefined) ??
      (o.targetRange as { start?: { line?: unknown; character?: unknown } } | undefined);
    if (!uri || !range) continue;
    const start = range.start;
    out.push({
      uri,
      line: typeof start?.line === "number" ? start.line : 0,
      character: typeof start?.character === "number" ? start.character : 0,
    });
  }
  return out;
}

/** Resolve a path and return (absPath, fileUri) for LSP requests. */
function resolveDoc(
  rawPath: string,
  ctx: ToolContext,
): { abs: string; uri: string } | { error: string } {
  const cwd = ctx.getCwd();
  let abs: string;
  if (rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath)) {
    abs = rawPath;
  } else if (cwd) {
    abs = cwd.endsWith("/") || cwd.endsWith("\\") ? `${cwd}${rawPath}` : `${cwd}/${rawPath}`;
  } else {
    return { error: "no active cwd to resolve a relative path" };
  }
  return { abs, uri: pathToFileUri(abs.replace(/\\/g, "/")) };
}

/**
 * LSP tools (R29 §3.7): expose the language server's hover / go-to-definition
 * to the agent. Read-only. They reuse the editor's live LSP sessions, so a
 * server only runs when the editor has the file open in a project root.
 */
export function buildLspTools(ctx: ToolContext) {
  return {
    lsp_hover: tool({
      description:
        "Ask the active language server for type/doc hover info at a position in a file. Returns the hover contents (types, docs, signatures). Read-only. Returns an error if no LSP session is live for the file (open it in the editor first).",
      inputSchema: z.object({
        path: z.string().describe("File path (absolute, or relative to cwd)."),
        line: z
          .number()
          .int()
          .min(0)
          .describe("0-based line number."),
        character: z
          .number()
          .int()
          .min(0)
          .describe("0-based character offset within the line."),
      }),
      execute: async ({ path, line, character }) => {
        const doc = resolveDoc(path, ctx);
        if ("error" in doc) return { error: doc.error };
        const sessions = sessionsForPath(doc.abs);
        if (sessions.length === 0) {
          return {
            error: `no active LSP session for ${doc.abs}; open the file in the editor first`,
          };
        }
        try {
          const hover = await sessions[0].client.textDocumentHover({
            textDocument: { uri: doc.uri },
            position: { line, character },
          });
          return { path: doc.abs, hover: hover ?? null };
        } catch (e) {
          return { error: `lsp hover failed: ${String(e)}`, path: doc.abs };
        }
      },
    }),

    lsp_goto: tool({
      description:
        "Ask the active language server where the symbol at a position is defined. Returns the definition location(s) with file + line. Read-only. Returns an error if no LSP session is live for the file.",
      inputSchema: z.object({
        path: z.string().describe("File path (absolute, or relative to cwd)."),
        line: z.number().int().min(0).describe("0-based line number."),
        character: z.number().int().min(0).describe("0-based character offset."),
      }),
      execute: async ({ path, line, character }) => {
        const doc = resolveDoc(path, ctx);
        if ("error" in doc) return { error: doc.error };
        const sessions = sessionsForPath(doc.abs);
        if (sessions.length === 0) {
          return {
            error: `no active LSP session for ${doc.abs}; open the file in the editor first`,
          };
        }
        try {
          const defs = await sessions[0].client.textDocumentDefinition({
            textDocument: { uri: doc.uri },
            position: { line, character },
          });
          const locations = normalizeLocations(defs);
          return {
            path: doc.abs,
            definitions: locations,
            count: locations.length,
          };
        } catch (e) {
          return { error: `lsp goto failed: ${String(e)}`, path: doc.abs };
        }
      },
    }),
  } as const;
}

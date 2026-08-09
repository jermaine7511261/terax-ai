import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

/**
 * §3.4.3 Import Cursor/Windsurf rules as yamet skills.
 * Parses `.cursorrules` (MDC format: YAML frontmatter + markdown body)
 * and converts them to yamet skill.json structure.
 */

interface CursorRulesPayload {
  name: string;
  description: string;
  prompt: string;
  toolAllowlist?: string[];
}

/** Parse a .cursorrules file (MDC: optional YAML frontmatter + markdown body). */
export function parseCursorRules(content: string): CursorRulesPayload {
  const metadata: Record<string, string> = {};
  let body = content;

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (fmMatch) {
    const [, frontmatter, rest] = fmMatch;
    body = rest.trim();
    for (const line of frontmatter.split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) {
        const key = line.slice(0, colon).trim();
        const val = line.slice(colon + 1).trim();
        if (key && val) metadata[key] = val;
      }
    }
  }

  const name =
    metadata.name ||
    metadata.globs?.replace(/[*/]/g, "-").replace(/^-+/, "").replace(/-+$/, "") ||
    "cursorrules-import";
  const description =
    metadata.description || metadata.desc || `Imported from .cursorrules`;

  return {
    name: name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    description,
    prompt: body,
  };
}

export function buildImportRulesTools(ctx: ToolContext) {
  return {
    import_rules: tool({
      description:
        "Import Cursor/Windsurf rules as yamet skills. Parses a .cursorrules file (MDC: YAML frontmatter + markdown body) into skill.json format and saves it under skills/. Requires approval.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the .cursorrules file to import"),
      }),
      needsApproval: true,
      execute: async ({ path }) => {
        const workspaceRoot = ctx.getWorkspaceRoot();
        if (!workspaceRoot) {
          return { error: "no active workspace; cannot import rules" };
        }

        try {
          const resolved =
            path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)
              ? path
              : `${workspaceRoot.replace(/\/$/, "")}/${path}`;

          const result = await native.readFile(resolved);
          if (result.kind !== "text") {
            return { error: `cannot read file: ${resolved} (binary)` };
          }

          const parsed = parseCursorRules(result.content);
          const skillDir = `${workspaceRoot.replace(/\/$/, "")}/skills`;
          const safeName = parsed.name
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "-")
            .replace(/^-+/, "");
          const targetDir = `${skillDir}/${safeName}`;
          const filePath = `${targetDir}/skill.json`;
          // Create the target dir first — a fresh skill name has no parent
          // directory and a bare write fails with ENOENT.
          try {
            await native.createDir(targetDir);
          } catch {
            // Already exists — the write below is the real arbiter.
          }

          const payload = {
            name: safeName,
            description: parsed.description,
            prompt: parsed.prompt,
            toolAllowlist: parsed.toolAllowlist ?? [
              "read_file",
              "list_directory",
              "grep",
              "glob",
              "write_file",
              "edit",
              "multi_edit",
            ],
          };

          await native.writeFile(filePath, JSON.stringify(payload, null, 2));

          return {
            ok: true,
            path: filePath,
            message: `imported rules as skill '${safeName}'`,
          };
        } catch (e) {
          return { error: `import failed: ${String(e)}` };
        }
      },
    }),
  } as const;
}

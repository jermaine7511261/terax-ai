import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import {
  appendProjectMemory,
  parseBlock,
  removeProjectMemory,
  updateProjectMemory,
  type ProjectMemoryEntry,
} from "../lib/transport";
import { getSessionMemory, useMemoryStore } from "../store/memoryStore";
import type { ToolContext } from "./context";

let nextMemoryId = 0;
function newMemoryId(): string {
  return `mem-${Date.now().toString(36)}-${(nextMemoryId++).toString(36)}`;
}

function describeEntry(id: string, content: string, source: string): string {
  return `${content}（${source}${id.startsWith("file:") ? " · 已落盘" : ""}）`;
}

export function buildMemoryTools(ctx: ToolContext) {
  return {
    update_project_memory: tool({
      description:
        "Persist a short, reusable fact or decision about this project so future sessions can recall it. Two-level: written to this session's memory immediately (visible to later turns) AND appended to YaMet.md on disk (survives restart). Use it for stable project facts — architecture decisions, naming conventions, gotchas, chosen libraries, avoided approaches. Keep each entry to one concise sentence. Replace an existing entry by passing the same id; omit id to append a new one. Auto-executes (no approval); refuses paths outside the workspace. When finishing a task with reusable findings, prefer persisting them here.",
      inputSchema: z.object({
        entry: z
          .string()
          .describe(
            'One concise, self-contained fact about the project, e.g. "We use pnpm, never npm."',
          ),
        id: z
          .string()
          .optional()
          .describe(
            "Existing entry id to replace (from a prior list_project_memory call); omit to append a new entry.",
          ),
        source: z
          .enum(["tool", "auto"])
          .optional()
          .describe(
            "Write source: agent tool (tool, default) or auto-settled at conversation end (auto).",
          ),
      }),
      execute: async ({ entry, id, source }) => {
        const sessionId = ctx.getSessionId();
        const trimmed = entry.trim();
        if (!trimmed)
          return { error: "empty memory entry", id: null, ok: false };

        const memId = id ?? newMemoryId();
        const now = Date.now();
        const memEntry: ProjectMemoryEntry = {
          id: memId,
          content: trimmed,
          createdAt: now,
          source: source ?? "tool",
        };

        // Level 1 — in-session store: immediately available to later turns.
        if (sessionId) {
          useMemoryStore.getState().addMemory(sessionId, memEntry);
        }

        // Level 2 — cross-session: persist to YaMet.md on disk.
        const workspaceRoot = ctx.getWorkspaceRoot();
        let persisted:
          | { ok: true; path: string }
          | { ok: false; reason: string }
          | null = null;
        if (workspaceRoot) {
          persisted = id
            ? await updateProjectMemory(workspaceRoot, memEntry)
            : await appendProjectMemory(workspaceRoot, memEntry);
        }

        // §3.5.1 Auto-compact: when YaMet.md entries exceed 20, compress oldest half.
        if (workspaceRoot && persisted?.ok) {
          const root = workspaceRoot;
          try {
            const re = await native.readFile(
              `${root.replace(/\/$/, "")}/YaMet.md`,
            );
            if (re.kind === "text" && "content" in re) {
              const text = (re as { kind: "text"; content: string }).content;
              const lines = parseBlock(text).lines.filter(
                (l: string) => l.trim(),
              );
              if (lines.length > 20) {
                const half = Math.floor(lines.length / 2);
                const oldLines = lines.slice(0, half);
                const newLines = lines.slice(half);
                const summaryLines = oldLines.map((l: string) => {
                  const t = l.replace(/^-\\s*/, "").trim();
                  const firstSentence = t.split(/[.。！？]/)[0];
                  return `- ${firstSentence || t}`;
                });
                const compacted = `[auto-compact] ${summaryLines.length} entries merged`;
                const merged = [compacted, ...newLines]
                  .map((l: string) => `- ${l.replace(/^-\\s*/, "")}`)
                  .join("\n");
                await native.writeFile(
                  `${root.replace(/\/$/, "")}/YaMet.md`,
                  `<!-- YaMet-project-memory:start -->\n${merged}\n<!-- YaMet-project-memory:end -->\n`,
                );
                console.log(
                  "[YaMet] auto-summarize triggered: compacted " +
                    oldLines.length +
                    " old entries",
                );
              }
            }
          } catch {
            // Non-fatal: auto-compact is best-effort.
          }
        }

        return {
          ok: true,
          id: memId,
          sessionOnly: !workspaceRoot,
          persisted: persisted?.ok ?? false,
          source: memEntry.source,
        };
      },
    }),

    list_project_memory: tool({
      description:
        "List all project memory entries: this session's in-memory notes plus the persisted YaMet.md block. Returns each entry's id (for delete_project_memory), content, source (tool/auto), and persisted flag. Use it before replacing or deleting an entry.",
      inputSchema: z.object({}),
      execute: async () => {
        const sessionId = ctx.getSessionId();
        const session = getSessionMemory(sessionId);
        const workspaceRoot = ctx.getWorkspaceRoot();
        const entries: Array<{
          id: string;
          content: string;
          source: "tool" | "auto";
          persisted: boolean;
        }> = [];
        const seen = new Set<string>();

        for (const e of session) {
          entries.push({
            id: e.id,
            content: e.content,
            source: e.source ?? "tool",
            persisted: Boolean(workspaceRoot),
          });
          seen.add(e.content.trim().toLowerCase());
        }

        if (workspaceRoot) {
          try {
            const r = await native.readFile(
              `${workspaceRoot.replace(/\/$/, "")}/YaMet.md`,
            );
            if (r.kind === "text" && "content" in r) {
              const content = (r as { kind: "text"; content: string }).content;
              for (const line of parseBlock(content).lines) {
                const c = line.replace(/^-\\s*/, "").trim();
                if (!c || seen.has(c.toLowerCase())) continue;
                seen.add(c.toLowerCase());
                entries.push({
                  id: `file:${c}`,
                  content: c,
                  source: "tool",
                  persisted: true,
                });
              }
            }
          } catch {
            // No YaMet.md yet — nothing persisted.
          }
        }

        return {
          entries,
          rendered: entries.map((e) => describeEntry(e.id, e.content, e.source)),
        };
      },
    }),

    delete_project_memory: tool({
      description:
        "Delete a project memory entry by its id (from a prior list_project_memory call). Both the in-session copy and the persisted YaMet.md copy (if any) are removed. Idempotent for missing entries.",
      inputSchema: z.object({
        id: z.string().describe("Entry id returned by list_project_memory."),
      }),
      execute: async ({ id }) => {
        const sessionId = ctx.getSessionId();
        const workspaceRoot = ctx.getWorkspaceRoot();

        // Persisted file entries use `file:<content>` synthetic ids.
        if (id.startsWith("file:")) {
          const content = id.slice("file:".length);
          if (!workspaceRoot) return { ok: false, reason: "no workspace open" };
          const res = await removeProjectMemory(workspaceRoot, content);
          return res.ok ? { ok: true } : { ok: false, reason: res.reason };
        }

        // Session entry: remove from store + persisted copy (matched by content).
        const entry = getSessionMemory(sessionId).find((e) => e.id === id);
        if (!entry) return { ok: false, reason: "entry not found" };
        if (sessionId) useMemoryStore.getState().removeMemory(sessionId, id);
        if (workspaceRoot) {
          const res = await removeProjectMemory(workspaceRoot, entry.content);
          return res.ok ? { ok: true } : { ok: false, reason: res.reason };
        }
        return { ok: true };
      },
    }),
  } as const;
}

import { tool } from "ai";
import { z } from "zod";
import {
  appendProjectMemory,
  updateProjectMemory,
  type ProjectMemoryEntry,
} from "../lib/transport";
import { useMemoryStore } from "../store/memoryStore";
import type { ToolContext } from "./context";

let nextMemoryId = 0;
function newMemoryId(): string {
  return `mem-${Date.now().toString(36)}-${(nextMemoryId++).toString(36)}`;
}

export function buildMemoryTools(ctx: ToolContext) {
  return {
    update_project_memory: tool({
      description:
        "Persist a short, reusable fact or decision about this project so future sessions can recall it. Two-level: written to this session's memory immediately (visible to later turns) AND appended to YAMET.md on disk (survives restart). Use it for stable project facts — architecture decisions, naming conventions, gotchas, chosen libraries, avoided approaches. Keep each entry to one concise sentence. Replace an existing entry by passing the same id; omit id to append a new one. Auto-executes (no approval); refuses paths outside the workspace.",
      inputSchema: z.object({
        entry: z.string().describe(
          "One concise, self-contained fact about the project, e.g. \"We use pnpm, never npm.\"",
        ),
        id: z
          .string()
          .optional()
          .describe(
            "Existing entry id to replace (from a prior read); omit to append a new entry.",
          ),
      }),
      execute: async ({ entry, id }) => {
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
        };

        // Level 1 — in-session store: immediately available to later turns.
        if (sessionId) {
          useMemoryStore.getState().addMemory(sessionId, memEntry);
        }

        // Level 2 — cross-session: persist to YAMET.md on disk.
        const workspaceRoot = ctx.getWorkspaceRoot();
        let persisted: { ok: true; path: string } | { ok: false; reason: string } | null =
          null;
        if (workspaceRoot) {
          persisted = id
            ? await updateProjectMemory(workspaceRoot, memEntry)
            : await appendProjectMemory(workspaceRoot, memEntry);
        }

        return {
          ok: true,
          id: memId,
          sessionOnly: !workspaceRoot,
          persisted: persisted?.ok ?? false,
        };
      },
    }),
  } as const;
}

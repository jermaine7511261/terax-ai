import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import type { ToolContext } from "./context";

/**
 * Git tools for the agent. Read-only status/diff auto-execute; mutating
 * stage/commit ask the user first. The repo root is resolved from the active
 * terminal cwd (or workspace root) via `git_resolve_repo`, so the model does
 * not need to know it — it just describes the work.
 */

async function resolveRepoRoot(ctx: ToolContext): Promise<string | null> {
  const cwd = ctx.getCwd() ?? ctx.getWorkspaceRoot();
  if (!cwd) return null;
  try {
    const info = await native.gitResolveRepo(cwd);
    return info?.repoRoot ?? null;
  } catch {
    return null;
  }
}

function summarizeStatus(status: {
  branch: string;
  ahead: number;
  behind: number;
  changedFiles: unknown[];
}): string {
  const lines = [
    `Branch: ${status.branch}`,
    status.ahead > 0 ? `${status.ahead} ahead of upstream` : null,
    status.behind > 0 ? `${status.behind} behind upstream` : null,
    `Changed files: ${status.changedFiles.length}`,
  ].filter(Boolean);
  return lines.join(", ");
}

export function buildGitTools(ctx: ToolContext) {
  return {
    git_status: tool({
      description:
        "Show the current git status (branch, ahead/behind upstream, and the list of changed files with their index/worktree state). Auto-executes (read-only). Use this before staging or committing to see what changed, or when the user asks about the repo state. Returns a message if cwd is not inside a git repo.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Cap the number of changed files returned. Default 100."),
      }),
      execute: async ({ limit }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        try {
          const status = await native.gitStatus(root);
          const cap = limit ?? 100;
          const files = status.changedFiles
            .slice(0, cap)
            .map(
              (f) =>
                `${f.statusLabel}  ${f.path}${f.originalPath ? ` (was ${f.originalPath})` : ""}`,
            );
          return {
            repoRoot: root,
            branch: status.branch,
            ahead: status.ahead,
            behind: status.behind,
            summary: summarizeStatus(status),
            changedFiles: files,
            truncated: status.changedFiles.length > cap,
            totalChanged: status.changedFiles.length,
          };
        } catch (e) {
          return { error: String(e), repoRoot: root };
        }
      },
    }),

    git_diff: tool({
      description:
        "Show the git diff. By default shows unstaged changes in the working tree. Set staged:true to see staged (index) changes instead. Optionally restrict to one path. Auto-executes (read-only). Use this to review exactly what changed before committing.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Optional repo-relative file path to limit the diff to. Omit for the whole change set.",
          ),
        staged: z
          .boolean()
          .optional()
          .describe("Show staged changes instead of unstaged. Default false."),
      }),
      execute: async ({ path, staged }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        try {
          const r = await native.gitDiff(root, path ?? null, staged ?? false);
          return {
            repoRoot: root,
            staged: staged ?? false,
            diffText: r.diffText,
            truncated: r.truncated,
          };
        } catch (e) {
          return { error: String(e), repoRoot: root };
        }
      },
    }),

    git_stage: tool({
      description:
        "Stage (git add) the given repo-relative file paths, or all changes if none given. Asks the user before running. Use git_status first to see what's available to stage.",
      inputSchema: z.object({
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Repo-relative paths to stage. Omit (or pass empty) to stage all changes.",
          ),
      }),
      needsApproval: true,
      execute: async ({ paths }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        try {
          const list = paths && paths.length > 0 ? paths : [];
          await native.gitStage(root, list);
          return {
            repoRoot: root,
            staged: list.length > 0 ? list : ["(all changes)"],
            ok: true,
          };
        } catch (e) {
          return { error: String(e), repoRoot: root };
        }
      },
    }),

    git_commit: tool({
      description:
        "Commit the currently staged changes with the given message. Asks the user before running. Use git_status + git_stage first so only the intended files are committed. Keep the message concise and imperative (e.g. 'fix: handle empty input').",
      inputSchema: z.object({
        message: z.string().describe("Commit message (concise, imperative)."),
      }),
      needsApproval: true,
      execute: async ({ message }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        if (!message.trim()) return { error: "commit message cannot be empty" };
        try {
          const r = await native.gitCommit(root, message.trim());
          return { repoRoot: root, ok: true, commit: r };
        } catch (e) {
          return { error: String(e), repoRoot: root };
        }
      },
    }),
  } as const;
}

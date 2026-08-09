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

    git_blame: tool({
      description:
        "Show per-line attribution (git blame) for a file in the repository. Returns each line with the last-touching commit sha, author, timestamp, and the commit's summary. Use to answer 'who/what/when changed this line' questions. Auto-executes (read-only).",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Repo-relative path (or absolute path inside the repo) of the file to blame.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe(
            "Cap the number of blame lines returned. Default 500 (first N lines).",
          ),
      }),
      execute: async ({ path, limit }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        try {
          const lines = await native.gitBlame(root, path);
          const cap = limit ?? 500;
          return {
            repoRoot: root,
            path,
            lines: lines.slice(0, cap).map((l) => ({
              line: l.line,
              sha: l.sha.slice(0, 8),
              author: l.author,
              time: l.time,
              summary: l.summary,
              content: l.content,
            })),
            truncated: lines.length > cap,
            totalLines: lines.length,
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

    git_checkpoint: tool({
      description:
        "Snapshot the current working tree before a risky batch of edits (N3 rollback safety). Uses `git stash create` — non-destructive: HEAD, your branch, and the index are untouched; the snapshot is recorded out-of-band so you can restore it later with git_checkpoint_restore. Returns the snapshot sha, or `null` when the working tree is clean. Call this before large multi-file changes to guarantee a one-command undo. Asks the user before running.",
      inputSchema: z.object({
        message: z
          .string()
          .optional()
          .describe("Short label for the snapshot (e.g. 'before refactor')."),
      }),
      needsApproval: true,
      execute: async ({ message }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        try {
          const cp = await native.gitCheckpointCreate(root, message);
          if (!cp) {
            return {
              repoRoot: root,
              message: "working tree is clean — nothing to snapshot",
              snapshot: null,
            };
          }
          return { repoRoot: root, snapshot: cp, ok: true };
        } catch (e) {
          return { error: String(e), repoRoot: root };
        }
      },
    }),

    git_checkpoint_restore: tool({
      description:
        "Restore a previously created snapshot (see git_checkpoint): resets the working tree + index to the snapshot's state via `git checkout <sha> -- .` without moving your branch. Use to undo a bad AI edit batch. Asks the user before running.",
      inputSchema: z.object({
        sha: z
          .string()
          .describe(
            "The snapshot sha returned by git_checkpoint (or from git_checkpoint_list).",
          ),
      }),
      needsApproval: true,
      execute: async ({ sha }) => {
        const root = await resolveRepoRoot(ctx);
        if (!root) return { note: "not inside a git repository" };
        if (!sha.trim()) return { error: "snapshot sha is required" };
        try {
          await native.gitCheckpointRestore(root, sha.trim());
          return { repoRoot: root, restored: sha.trim(), ok: true };
        } catch (e) {
          return { error: String(e), repoRoot: root };
        }
      },
    }),
  } as const;
}

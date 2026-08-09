/**
 * Git command handlers for the web backend (WebUI 服务端域扩展).
 * Read-only subset: status / log / diff. Mutating git (stage/commit/push)
 * stays Tauri-only — the web build must not widen the write surface.
 */

import { register } from "../registry";
import { execFile } from "node:child_process";

function runGit(args: string[], cwd: string, timeoutSecs = 20): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutSecs * 1000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (err as { code?: number }).code ?? -1 : 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      },
    );
  });
}

async function repoRoot(cwd: string): Promise<string> {
  const r = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (r.code !== 0) throw new Error(`not a git repository: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

register("git_resolve_repo", async (args) => {
  const cwd = (args.cwd as string) || ".";
  return repoRoot(cwd);
});

register("git_status", async (args) => {
  const cwd = (args.cwd as string) || ".";
  await repoRoot(cwd);
  // --porcelain=v1: stable machine format for parsing on the frontend.
  const r = await runGit(["status", "--porcelain=v1"], cwd);
  if (r.code !== 0) return { entries: [], error: r.stderr.trim() };
  const entries = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      raw: line,
      x: line.slice(0, 1).trim(),
      y: line.slice(1, 2).trim(),
      path: line.slice(3),
    }));
  return { entries };
});

register("git_log", async (args) => {
  const cwd = (args.cwd as string) || ".";
  // Clamp + integerize the limit so a malicious/negative value can't reach the
  // shell (e.g. `git log -n -5` errors or worse).
  const raw = typeof args.limit === "number" ? Math.trunc(args.limit) : 20;
  const limit = Math.min(Math.max(raw, 1), 500);
  await repoRoot(cwd);
  const r = await runGit(
    ["log", "-n", String(limit), "--format=%H%x09%an%x09%ae%x09%ad%x09%s", "--date=short"],
    cwd,
  );
  if (r.code !== 0) return { entries: [], error: r.stderr.trim() };
  const entries = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, author, email, date, ...rest] = line.split("\t");
      return { hash, author, email, date, subject: rest.join("\t") };
    });
  return { entries };
});

register("git_diff", async (args) => {
  const cwd = (args.cwd as string) || ".";
  const statOnly = args.stat !== false;
  await repoRoot(cwd);
  const r = await runGit(statOnly ? ["diff", "--stat"] : ["diff"], cwd);
  if (r.code !== 0) return { diff: "", error: r.stderr.trim() };
  return { diff: r.stdout };
});

register("git_diff_content", async (args) => {
  const cwd = (args.cwd as string) || ".";
  await repoRoot(cwd);
  const r = await runGit(["diff"], cwd);
  if (r.code !== 0) return { diff: "", error: r.stderr.trim() };
  return { diff: r.stdout };
});

register("git_list_branches", async (args) => {
  const cwd = (args.cwd as string) || ".";
  await repoRoot(cwd);
  const r = await runGit(["branch", "--format=%(refname:short)"], cwd);
  if (r.code !== 0) return { branches: [], error: r.stderr.trim() };
  return { branches: r.stdout.split("\n").filter(Boolean) };
});

// Guard: refuse to widen the web write surface. These Tauri-only mutations
// must NOT be registered here.
export const __GIT_WRITE_BLOCKED = ["git_stage", "git_unstage", "git_commit", "git_push"];

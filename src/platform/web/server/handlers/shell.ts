/**
 * Shell command handlers for the web backend.
 *
 * SECURITY (SHOULD, round-25 全量优化):
 *   - `cwd` must resolve inside the workspace (no arbitrary path reads).
 *   - Timeout kills the whole process tree (Windows: taskkill /T /F; POSIX:
 *     process group SIGKILL) so a spawned child can't outlive its shell.
 *   - Output is capped to bound memory.
 */

import { register } from "../registry";
import { spawn } from "node:child_process";
import * as path from "node:path";

let workspaceRoot = process.cwd();

export function setWorkspaceRoot(root: string): void {
  workspaceRoot = root;
}

function resolveCwd(cwd: string | undefined): string {
  const base = cwd?.trim() ? cwd : ".";
  const abs = path.resolve(workspaceRoot, base);
  const rel = path.relative(workspaceRoot, abs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`cwd escapes workspace: ${cwd}`);
  }
  return abs;
}

function killTree(proc: ReturnType<typeof spawn>, isWin: boolean): void {
  if (isWin) {
    if (proc.pid) spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-(proc.pid as number), "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }
}

register("shell_run_command", async (args) => {
  const command = args.command as string;
  if (!command?.trim()) throw new Error("command is required");
  const cwd = resolveCwd(args.cwd as string | undefined);
  const timeoutSecs = (args.timeoutSecs as number) ?? 30;
  const isWin = process.platform === "win32";

  return new Promise((resolve) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
      detached: !isWin, // new process group on POSIX so we can group-kill
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(proc, isWin);
    }, timeoutSecs * 1000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      // Truncate very long output.
      const MAX = 1024 * 1024;
      let truncated = false;
      if (stdout.length > MAX) { stdout = `${stdout.slice(0, MAX)}\n... (truncated)`; truncated = true; }
      if (stderr.length > MAX) { stderr = `${stderr.slice(0, MAX)}\n... (truncated)`; truncated = true; }
      resolve({ stdout, stderr, exit_code: code, timed_out: timedOut, truncated });
    });

    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: e.message, exit_code: -1, timed_out: false, truncated: false });
    });
  });
});

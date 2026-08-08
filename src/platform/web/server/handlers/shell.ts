/**
 * Shell command handlers for the web backend.
 */

import { register } from "../registry";
import { spawn } from "node:child_process";

let workspaceRoot = process.cwd();

export function setWorkspaceRoot(root: string): void {
  workspaceRoot = root;
}

register("shell_run_command", async (args) => {
  const command = args.command as string;
  const cwd = (args.cwd as string) || workspaceRoot;
  const timeoutSecs = (args.timeoutSecs as number) ?? 30;

  return new Promise((resolve) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
      timeout: timeoutSecs * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutSecs * 1000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      // Truncate very long output
      const MAX = 1024 * 1024;
      if (stdout.length > MAX) stdout = stdout.slice(0, MAX) + "\n... (truncated)";
      if (stderr.length > MAX) stderr = stderr.slice(0, MAX) + "\n... (truncated)";
      resolve({
        stdout,
        stderr,
        exit_code: code,
        timed_out: timedOut,
        truncated: stdout.length >= MAX || stderr.length >= MAX,
      });
    });

    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: e.message,
        exit_code: -1,
        timed_out: false,
        truncated: false,
      });
    });
  });
});

import { tool } from "ai";
import { z } from "zod";
import { quoteShellArg } from "@/lib/shellQuote";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

export type ExternalAgentId =
  | "claude"
  | "codex"
  | "opencode"
  | "gemini"
  | "pi"
  | "grok";

const AGENT_LABELS: Record<ExternalAgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  pi: "Pi",
  grok: "Grok",
};

/**
 * Build the non-interactive invocation for an external agent CLI.
 *
 * - Claude Code: `claude -p <prompt> --output-format text` — print mode skips
 *   the trust/permission dialogs, returns the result and exits.
 * - Codex: `codex exec <prompt>`.
 * - OpenCode: `opencode run <prompt>`.
 * - gemini/pi/grok: print via `-p` / `-q` as appropriate.
 *
 * The prompt is single-quoted so shell metacharacters inside it can't inject a
 * second command. The whole line is validated by checkShellCommand too.
 */
export function buildExternalAgentCommand(
  agent: ExternalAgentId,
  prompt: string,
  cwd: string | null,
): string {
  const quoted = quoteShellArg(prompt);
  let base: string;
  switch (agent) {
    case "claude":
      base = `claude -p ${quoted} --output-format text --max-turns 8`;
      break;
    case "codex":
      base = `codex exec ${quoted}`;
      break;
    case "opencode":
      base = `opencode run ${quoted}`;
      break;
    case "gemini":
      base = `gemini -p ${quoted}`;
      break;
    case "pi":
      base = `pi -p ${quoted}`;
      break;
    case "grok":
      base = `grok -p ${quoted}`;
      break;
  }
  return cwd ? `cd ${quoteShellArg(cwd)} && ${base}` : base;
}

const POLL_INTERVAL_MS = 1200;
const MAX_POLL_SECS = 180;

async function waitForExit(
  handle: number,
): Promise<{ bytes: string; exit_code: number | null; dropped: number }> {
  let since = 0;
  let acc = "";
  let dropped = 0;
  const start = Date.now();
  while (true) {
    const r = await native.shellBgLogs(handle, since);
    acc += r.bytes;
    since = r.next_offset;
    dropped += r.dropped;
    if (r.exited) return { bytes: acc, exit_code: r.exit_code, dropped };
    if (Date.now() - start > MAX_POLL_SECS * 1000) {
      await native.shellBgKill(handle);
      return {
        bytes: acc,
        exit_code: null,
        dropped,
      };
    }
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
}

export function buildExternalAgentTools(ctx: ToolContext) {
  return {
    run_external_agent: tool({
      description:
        "Delegate a self-contained coding task to an external agent CLI (Claude Code, Codex, OpenCode, Gemini, Pi, or Grok). The CLI runs in non-interactive print mode in the given cwd; output is captured and returned when it exits. Use for large autonomous tasks (big refactors, multi-file features) better suited to a dedicated agent. Asks for approval. Prefer this over bash_run for long autonomous work; the subagent result comes back complete.",
      inputSchema: z.object({
        agent: z
          .enum(["claude", "codex", "opencode", "gemini", "pi", "grok"])
          .describe("The external agent CLI to run."),
        prompt: z
          .string()
          .min(1)
          .describe(
            "Self-contained task prompt. The CLI has no memory of this conversation — include all context it needs (files, goals, constraints).",
          ),
        cwd: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Working directory for the agent. Defaults to the active terminal cwd.",
          ),
      }),
      needsApproval: true,
      execute: async ({ agent, prompt, cwd }) => {
        const agents = await native.agentProbe().catch(() => []);
        const info = agents.find((a) => a.id === agent);
        if (!info?.available) {
          return {
            error: `${AGENT_LABELS[agent as ExternalAgentId] ?? agent} is not installed or not on PATH. Install it first, then retry.`,
            available: agents.map((a) => ({
              id: a.id,
              available: a.available,
              version: a.version,
            })),
          };
        }
        if (info.version) {
          // Version-compat hint: Claude Code print mode requires v2.x.
          if (
            agent === "claude" &&
            !/^v?2\./.test(info.version) &&
            !info.version.toLowerCase().includes("2.")
          ) {
            return {
              error: `Claude Code v2+ is required for print mode; found "${info.version}". Run \`claude update\` or install a newer version.`,
              version: info.version,
            };
          }
        }

        const effectiveCwd = cwd ?? ctx.getCwd();
        const command = buildExternalAgentCommand(
          agent as ExternalAgentId,
          prompt,
          effectiveCwd,
        );
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };

        try {
          const handle = await native.shellBgSpawn(command, effectiveCwd);
          const { bytes, exit_code, dropped } = await waitForExit(handle);
          return {
            ok: true,
            agent,
            command,
            output: bytes,
            exit_code,
            truncated: dropped > 0,
            dropped_bytes: dropped,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}

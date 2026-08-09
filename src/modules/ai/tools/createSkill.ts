import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { parseSkillJson, scanSkillsDir } from "../lib/skills";
import { checkWritableCanonical } from "../lib/security";
import { normalizeHandle } from "../lib/snippets";
import { useSnippetsStore } from "../store/snippetsStore";
import type { ToolContext } from "./context";

/**
 * Skills auto-distillation (★ H2). After a long task the agent can call
 * `create_skill(name, prompt, toolAllowlist?, handle?)` to persist a reusable
 * skill under `<workspace>/skills/<name>/skill.json`, which the settings page
 * and `useAiBootstrap` then pick up as a `builtin: true` snippet.
 */

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
/** Skill names become directory names under `<workspace>/skills/` — keep them
 *  filesystem-safe: lowercase alphanumeric + `-`/`_` only (S4). */
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Validate a skill file payload. Returns an error string, or null when valid.
 */
export function validateSkillFields(input: {
  name: string;
  prompt: string;
  handle?: string;
  toolAllowlist?: string[];
}): string | null {
  if (!input.name.trim()) return "skill name cannot be empty";
  if (!NAME_RE.test(input.name.trim().toLowerCase())) {
    return `invalid skill name '${input.name.trim()}': use lowercase letters, digits, '-', '_' (e.g. 'fix-ts')`;
  }
  if (!input.prompt.trim()) return "skill prompt cannot be empty";
  if (input.handle?.trim()) {
    if (!HANDLE_RE.test(input.handle.trim())) {
      return `invalid handle '${input.handle}': must match /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/`;
    }
  }
  if (
    input.toolAllowlist !== undefined &&
    !input.toolAllowlist.every((t) => typeof t === "string" && t.trim())
  ) {
    return "toolAllowlist must contain only non-empty strings";
  }
  return null;
}

/** The skill.json payload to write for a validated request. */
export function buildSkillPayload(input: {
  name: string;
  description: string;
  prompt: string;
  handle?: string;
  toolAllowlist?: string[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: input.name.trim().toLowerCase(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    // P1-5: mark agent-created + stamp first activity so the background curator
    // knows this skill is eligible for lifecycle maintenance.
    agent_created: true,
    created_at: Date.now(),
    activity_ts: Date.now(),
    usage_count: 0,
  };
  const handle = input.handle?.trim();
  if (handle) payload.handle = normalizeHandle(handle);
  if (input.toolAllowlist && input.toolAllowlist.length > 0) {
    payload.toolAllowlist = input.toolAllowlist.map((t) => t.trim());
  }
  return payload;
}

/**
 * §3.4.2 Auto-distill hint: when a subagent completes a complex task
 * (steps ≥ 5, no error), suggest saving the pattern as a skill.
 * Returns a suggested skill payload, or null if no suggestion.
 */
export function suggestSkillFromRun(
  summary: string,
  stepCount: number,
  toolNames: string[],
): { name: string; description: string; prompt: string; toolAllowlist: string[] } | null {
  if (stepCount < 5) return null;
  if (!summary || summary.trim().length === 0) return null;
  const name = `distill-${Date.now().toString(36).slice(-6)}`;
  return {
    name,
    description: `Auto-extracted from a ${stepCount}-step task`,
    prompt: summary.slice(0, 4096),
    toolAllowlist: toolNames.slice(0, 20),
  };
}

export function buildCreateSkillTools(ctx: ToolContext) {
  return {
    create_skill: tool({
      description:
        "Persist a reusable skill to this workspace's skills/ directory (`<workspace>/skills/<name>/skill.json`) so it appears in the settings skills list and can be recalled in future sessions. Use after a long, successful task that involved a repeatable procedure — capture the reusable steps as a concise prompt. Requires user approval. A skill is a named instruction prompt; pass `toolAllowlist` to restrict which tools the skill may use when invoked.",
      inputSchema: z.object({
        name: z
          .string()
          .describe("Skill name (used as the directory/file name)."),
        prompt: z
          .string()
          .describe(
            "The reusable instruction prompt the skill should inject when invoked.",
          ),
        description: z
          .string()
          .optional()
          .describe("Short one-line description of what the skill does."),
        handle: z
          .string()
          .optional()
          .describe(
            "Optional invocation handle (lowercase, `[a-z0-9_-]`). Defaults to the normalized name.",
          ),
        toolAllowlist: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of tool names the skill is allowed to use.",
          ),
      }),
      needsApproval: true,
      execute: async ({
        name,
        prompt,
        description,
        handle,
        toolAllowlist,
      }) => {
        const validation = validateSkillFields({
          name,
          prompt,
          handle,
          toolAllowlist,
        });
        if (validation) return { error: validation };

        const workspaceRoot = ctx.getWorkspaceRoot();
        if (!workspaceRoot) {
          return { error: "no active workspace; cannot persist a skill" };
        }

        const dir = `${workspaceRoot.replace(/\/$/, "")}/skills`;
        // Name was validated to /^[a-z0-9][a-z0-9_-]*$/ above, so it is a safe
        // single directory component (no dots, no separators).
        const safeName = name.trim().toLowerCase();
        const skillDir = `${dir}/${safeName}`;
        const filePath = `${skillDir}/skill.json`;

        // Workspace authorization: the skill path must be writable within the
        // workspace.
        const writeCheck = await checkWritableCanonical(filePath, native.canonicalize);
        if (!writeCheck.ok) return { error: writeCheck.reason };

        // Target directory may not exist for a fresh skill name — create it
        // first or the write fails with ENOENT (R29 verification found this
        // live: create_skill on a new name → os error 3). fs_create_dir builds
        // the chain; "already exists" is tolerated below.
        try {
          await native.createDir(skillDir);
        } catch {
          // Directory may already exist from a prior run — the write below is
          // the real arbiter.
        }

        const payload = buildSkillPayload({
          name,
          description: description ?? "",
          prompt,
          handle,
          toolAllowlist,
        });
        const json = JSON.stringify(payload, null, 2);

        try {
          await native.writeFile(filePath, json);
        } catch (e) {
          return { error: `failed to write skill: ${String(e)}` };
        }

        // Validate what we wrote back.
        const re = await native.readFile(filePath);
        if (re.kind === "text" && !parseSkillJson(re.content)) {
          return { error: "skill wrote but failed validation; check prompt" };
        }

        // Refresh the builtin skills store so it appears immediately.
        try {
          const builtins = await scanSkillsDir(workspaceRoot);
          useSnippetsStore.getState().mergeBuiltin(builtins);
        } catch {
          // Non-fatal: store refresh happens again on next boot/settings scan.
        }

        return {
          ok: true,
          path: filePath,
          message: `skill '${safeName}' created`,
        };
      },
    }),
  };
}

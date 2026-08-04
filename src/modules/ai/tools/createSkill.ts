import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { parseSkillJson, scanSkillsDir } from "../lib/skills";
import { checkWritableCanonical } from "../lib/security";
import { normalizeHandle } from "../lib/snippets";
import { useSnippetsStore } from "../store/snippetsStore";
import type { ToolContext } from "./context";

/**
 * Skills auto-distillation (★ H2 Hermes). After a long task the agent can call
 * `create_skill(name, prompt, toolAllowlist?, handle?)` to persist a reusable
 * skill under `<workspace>/skills/<name>/skill.json`, which the settings page
 * and `useAiBootstrap` then pick up as a `builtin: true` snippet.
 */

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

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
  if (!input.prompt.trim()) return "skill prompt cannot be empty";
  if (input.handle !== undefined && input.handle.trim()) {
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
    name: input.name.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
  };
  const handle = input.handle?.trim();
  if (handle) payload.handle = normalizeHandle(handle);
  if (input.toolAllowlist && input.toolAllowlist.length > 0) {
    payload.toolAllowlist = input.toolAllowlist.map((t) => t.trim());
  }
  return payload;
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
        const safeName = name.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${dir}/${safeName}/skill.json`;

        // Workspace authorization: the skill path must be writable within the
        // workspace.
        const writeCheck = await checkWritableCanonical(filePath, native.canonicalize);
        if (!writeCheck.ok) return { error: writeCheck.reason };

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

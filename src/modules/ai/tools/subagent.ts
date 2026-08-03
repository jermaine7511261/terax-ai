import { tool } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runSubagent } from "../agents/runSubagent";
import { SUBAGENTS, type SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import type { ToolContext } from "./context";

const TYPE_KEYS = Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]];

// Read-only research subagents auto-execute; writable/executor subagents
// (code, executor) ask the user first, since they may edit files / run shells.
function requiresApproval(type: string): boolean {
  return type === "code" || type === "executor";
}

export function buildSubagentTools(ctx: ToolContext) {
  return {
    run_subagent: tool({
      description: `Spawn an isolated subagent with its own restricted toolset and a fresh message history. Use it to delegate a self-contained investigation (large search, code review, security audit) without polluting your own context, or to hand off a focused implementation/execution task to a writable worker. The subagent returns a single text summary; pick a 'type' that matches its job.

Types:
${TYPE_KEYS.map((k) => `- ${k}: ${SUBAGENTS[k].description}`).join("\n")}

Read-only types (explore / code-review / security / general) auto-execute. Writable types (code / executor) ask the user for approval because they may edit files and run shell commands.`,
      inputSchema: z.object({
        type: z.enum(TYPE_KEYS),
        prompt: z
          .string()
          .describe(
            "Self-contained instruction. The subagent has no memory of prior conversation — include all relevant context.",
          ),
        description: z
          .string()
          .optional()
          .describe("Short label shown in the chat UI for the spawn card."),
      }),
      // Dynamic approval: only writable/executor types interrupt for a confirm.
      needsApproval: (input) => {
        const t = (input as { type?: unknown } | undefined)?.type;
        return typeof t === "string" && requiresApproval(t);
      },
      execute: async ({ type, prompt, description }) => {
        const { apiKeys, selectedModelId, customEndpointKeys, patchAgentMeta } =
          useChatStore.getState();
        const customEndpoints = usePreferencesStore.getState().customEndpoints;
        try {
          const r = await runSubagent({
            type,
            prompt,
            keys: apiKeys,
            modelId: selectedModelId,
            customEndpoints,
            customEndpointKeys,
            toolContext: ctx,
            onStep: (label) => patchAgentMeta({ step: label }),
          });
          return {
            type,
            description,
            summary: r.summary,
            stepCount: r.stepCount,
            durationMs: r.durationMs,
          };
        } catch (e) {
          return { error: String(e), type };
        }
      },
    }),
  } as const;
}

import { tool } from "ai";
import { z } from "zod";
import { runSubagent } from "../agents/runSubagent";
import { SUBAGENTS, type SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  newActivityId,
  useAgentActivityStore,
} from "../store/agentActivityStore";
import type { ToolContext } from "./context";

const TYPE_KEYS = Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]];

/**
 * Handoff (R28 #7,  `handoffs`): transfer CONTROL to another agent,
 * not a sub-delegation. After a successful handoff the receiving agent owns
 * the task; the caller should stop rather than echo the result back.
 * Semantically distinct from run_subagent (delegation returns to the caller).
 */
export function buildHandoffTools(ctx: ToolContext) {
  return {
    handoff: tool({
      description: `Transfer control of the current task to another agent. The receiving agent owns the task from here; after a SUCCESSFUL handoff, STOP and do not continue the task yourself. Use when a specialist should take over (e.g. a security agent for a vuln hunt, an architect for a design decision) instead of you finishing it. The handoff carries the given context; the receiver has no memory of this conversation.

Agents:
${TYPE_KEYS.map((k) => `- ${k}: ${SUBAGENTS[k].description}`).join("\n")}`,
      inputSchema: z.object({
        agent: z.enum(TYPE_KEYS),
        context: z
          .string()
          .describe(
            "Everything the receiving agent needs to continue: state, findings, open questions, exact next step.",
          ),
      }),
      needsApproval: true,
      execute: async ({ agent, context }) => {
        const { apiKeys, selectedModelId, customEndpointKeys } =
          useChatStore.getState();
        const customEndpoints = usePreferencesStore.getState().customEndpoints;
        const actId = newActivityId();
        const store = useAgentActivityStore.getState();
        store.start({
          id: actId,
          kind: "subagent",
          type: agent,
          prompt: context,
          status: "running",
          step: null,
          startedAt: Date.now(),
        });
        try {
          const r = await runSubagent({
            type: agent,
            prompt: context,
            keys: apiKeys,
            modelId: selectedModelId,
            customEndpoints,
            customEndpointKeys,
            toolContext: ctx,
            onStep: (label) => store.updateStep(actId, label),
          });
          store.finish(actId, r.summary, r.stepCount);
          return {
            transferred: true,
            to: agent,
            summary: r.summary,
            stepCount: r.stepCount,
            durationMs: r.durationMs,
          };
        } catch (e) {
          store.fail(actId, String(e));
          return { transferred: false, to: agent, error: String(e) };
        }
      },
    }),
  } as const;
}

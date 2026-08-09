import { tool } from "ai";
import { z } from "zod";
import { useChatStore } from "../store/chatStore";
import { runSubagent } from "../agents/runSubagent";
import type { ToolContext } from "./context";

/**
 * §3.3 Multi-model fusion (Model Jury).
 * Phase 1: delegate_many with per-task modelId override.
 * Phase 2: judge synthesizes a unified answer from all panel responses.
 */
export function buildFusionTools(ctx: ToolContext) {
  return {
    model_fusion: tool({
      description:
        "Multi-model fusion: the same question answered in parallel by N models, then a judge model synthesizes a unified answer. Use for high-reliability research questions. Pass `query` and a `models` array (2-8), each an OpenAI-compatible model id. Requires approval.",
      inputSchema: z.object({
        query: z.string().describe("The research question."),
        models: z
          .array(z.string())
          .min(2)
          .max(8)
          .describe("Participating model ids (provider/modelId)."),
        judge_model: z
          .string()
          .optional()
          .describe("Judge model (defaults to the primary provider)."),
      }),
      needsApproval: true,
      execute: async ({ query, models, judge_model }) => {
        const keys = await import("../lib/keyring").then((m) =>
          m.getAllKeys(),
        );
        const selectedModel =
          judge_model ?? useChatStore.getState().selectedModelId;

        // Phase 1: delegate_many with per-task modelId override
        // The delegateMany tool's task schema doesn't natively support modelId,
        // so we call runSubagent directly for each model in parallel.
        const results = await Promise.allSettled(
          models.map(async (modelId) => {
            const result = await runSubagent({
              type: "general",
              prompt: query,
              keys,
              modelId,
              toolContext: ctx,
            });
            return { modelId, summary: result.summary };
          }),
        );

        const panel = results.map((r, i) => {
          if (r.status === "fulfilled") {
            return r.value;
          }
          return { modelId: models[i], summary: `(error: ${String(r.reason)})` };
        });

        // Phase 2: judge synthesis
        const judgePrompt = `You are the judge. Below are ${models.length} models' answers to the same question. Synthesize the most accurate, comprehensive unified answer, citing each source model. Where they disagree, weigh each argument and state your ruling.

${panel.map((r) => `--- model ${r.modelId} ---\n${r.summary}`).join("\n\n")}`;

        const judgeResult = await runSubagent({
          type: "general",
          prompt: judgePrompt,
          keys,
          modelId: selectedModel ?? models[0],
          toolContext: ctx,
        });

        return {
          report: judgeResult.summary,
          panel: panel.map((r) => ({
            model: r.modelId,
            answer: r.summary.slice(0, 2000),
          })),
          modelCount: models.length,
        };
      },
    }),
  } as const;
}

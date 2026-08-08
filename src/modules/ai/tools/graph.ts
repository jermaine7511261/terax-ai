import { tool } from "ai";
import { z } from "zod";
import { generateText, stepCountIs } from "ai";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { buildConfiguredLanguageModel } from "../lib/agent";
import { runSubagent } from "../agents/runSubagent";
import { useChatStore } from "../store/chatStore";
import {
  newActivityId,
  useAgentActivityStore,
} from "../store/agentActivityStore";
import { setGraphHooks, useGraphStore } from "../graph/store";
import type { GraphNode } from "../graph/types";
import type { ToolContext } from "./context";

const JUDGE_MODEL = "deepseek-v4-flash";

function buildHooks(ctx: ToolContext) {
  const { apiKeys, customEndpointKeys } = useChatStore.getState();
  const customEndpoints = usePreferencesStore.getState().customEndpoints;
  const store = useAgentActivityStore.getState();
  const selectedModelId = useChatStore.getState().selectedModelId;

  return {
    runAgent: async (node: GraphNode, context: string) => {
      const actId = newActivityId();
      store.start({
        id: actId,
        kind: "graph",
        type: node.agent ?? "agent",
        prompt: node.prompt ?? "",
        status: "running",
        step: null,
        startedAt: Date.now(),
      });
      try {
        const r = await runSubagent({
          type: (node.agent as Parameters<typeof runSubagent>[0]["type"]) ?? "general",
          prompt: node.prompt ?? "",
          context: context || undefined,
          keys: apiKeys,
          modelId: selectedModelId,
          customEndpoints,
          customEndpointKeys,
          toolContext: ctx,
          onStep: (label) => store.updateStep(actId, label),
        });
        store.finish(actId, r.summary, r.stepCount);
        return { output: r.summary, stepCount: r.stepCount };
      } catch (e) {
        store.fail(actId, String(e));
        throw e;
      }
    },
    judge: async (node: GraphNode, context: string) => {
      // Ask the LLM to pick one of the branch targets.
      const branches = node.branches ?? {};
      const choices = Object.entries(branches)
        .map(([target, label]) => `- ${target}: ${label}`)
        .join("\n");
      const model = await buildConfiguredLanguageModel(
        JUDGE_MODEL,
        apiKeys,
        { customEndpoints, customEndpointKeys },
      );
      const res = await generateText({
        model,
        system:
          "You are a graph router. Choose exactly ONE branch target id from the provided options, based on the given context. Reply with ONLY the target id, nothing else.",
        prompt: `Context:\n${context}\n\nBranches:\n${choices}\n\nPick one target id:`,
        stopWhen: stepCountIs(2),
      });
      const chosen = res.text.trim();
      return branches[chosen] ? chosen : Object.keys(branches)[0] ?? "";
    },
  };
}

export function buildGraphTools(ctx: ToolContext) {
  return {
    run_graph: tool({
      description:
        "Orchestrate a multi-step graph run (L4): a light sequence of agent/judge/human/merge nodes that execute in dependency order (independent nodes run in parallel). Use it for a task that decomposes into an explicit pipeline or branch. Provide a graph def as JSON: { name, nodes: [{id, kind: agent|judge|human|merge, name?, agent?, prompt?, branches?}], edges: [{from, to}] }. For an agent node, `agent` is a subagent type (explore/code/…); for a judge node, `branches` maps target-node-id -> label. Human nodes pause for your approval. The run is journaled and can be resumed on the same graph id. Requires approval.",
      inputSchema: z.object({
        graph: z
          .string()
          .describe(
            'JSON graph definition: {"name": string, "nodes": [...], "edges": [...]}. See tool description for node/edge schema.',
          ),
        resume: z
          .boolean()
          .optional()
          .describe(
            "Resume a previously interrupted run with the same graph id (reuse completed nodes from the journal).",
          ),
      }),
      needsApproval: true,
      execute: async ({ graph, resume }) => {
        let def;
        try {
          def = JSON.parse(graph);
        } catch (e) {
          return { ok: false, error: `invalid graph JSON: ${String(e)}` };
        }
        if (!Array.isArray(def.nodes) || !Array.isArray(def.edges)) {
          return { ok: false, error: "graph must have nodes[] and edges[]" };
        }
        // Deterministic id from name when not provided.
        if (!def.id) {
          def.id = `g-${(def.name ?? "graph").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
        }
        setGraphHooks(buildHooks(ctx));
        await useGraphStore.getState().run(def as never, { resume });
        const run = useGraphStore.getState().runs[def.id];
        return {
          ok: run?.status === "done",
          status: run?.status,
          graphId: def.id,
          nodes: Object.fromEntries(
            Object.entries(run?.nodes ?? {}).map(([id, st]) => [
              id,
              { status: st.status, output: st.output, error: st.error },
            ]),
          ),
        };
      },
    }),
  } as const;
}

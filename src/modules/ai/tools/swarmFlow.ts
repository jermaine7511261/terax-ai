import { tool } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runSubagent } from "../agents/runSubagent";
import { SUBAGENTS, type SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import {
  newActivityId,
  useAgentActivityStore,
} from "../store/agentActivityStore";
import type { ToolContext } from "./context";

/**
 * `swarm_flow` — declarative multi-agent pipeline orchestration.
 *
 * Instead of hand-writing several sequential `delegate_many` calls, describe
 * the whole pipeline in one flow-DSL string:
 *
 *   "A, B -> C -> D"
 *
 *   - `,`  = run those nodes in PARALLEL within the same stage
 *   - `->` = SEQUENTIAL relay: the next stage's context is built from the
 *            previous stage's outputs
 *   - `H`  = a HUMAN confirmation gate. It does not run a subagent; it records
 *            a gate entry in `human_gates` and returns so the main agent can
 *            ask the user before continuing.
 *
 * Each named node maps to a subagent type via `types` (default `general`).
 * The whole pipeline is executed with the same bounded-wave concurrency
 * (max 4 workers per parallel stage) used by `delegate_many`, but is
 * implemented here directly over `runSubagent` (no coupling to delegate_many).
 */

/** Parallel worker cap per stage (mirrors delegate_many). */
export const MAX_PARALLEL_WORKERS = 4;

const TYPE_KEYS = Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]];

export type AggregateMode = "final" | "list" | "dict";

export type SwarmStepResult = {
  node: string;
  summary: string;
  durationMs: number;
  ok: boolean;
  /** True when this is a human gate node (no subagent ran). */
  gate?: boolean;
  error?: string;
  stepCount?: number;
  lastStep?: string | null;
};

export type SwarmStepSummary = { node: string; summary: string };

export type SwarmFlowResult = {
  ok: boolean;
  steps: SwarmStepResult[];
  /** Aggregated per `aggregate`: "final" → string, "list" → array,
   *  "dict" → Record<node, summary>. */
  final: string | SwarmStepSummary[] | Record<string, string>;
  human_gates: string[];
  aggregate: AggregateMode;
  error?: string;
};

/** Normalize an unknown thrown value to a readable error string. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Parse a flow-DSL string into ordered stages. Each stage is an array of
 * node names (parallel within a stage; stages are sequential).
 *
 *   parseFlow("A, B -> C -> D") => [["A","B"],["C"],["D"]]
 *   parseFlow("A ->  -> B")     => [["A"],["B"]]          (empty stages dropped)
 *   parseFlow("")               => []
 *
 * `H` (case-insensitive) is treated as a reserved human-gate node.
 */
export function parseFlow(flow: string): string[][] {
  return flow
    .split("->")
    .map((stage) =>
      stage
        .split(",")
        .map((node) => node.trim())
        .filter((node) => node.length > 0),
    )
    .filter((stage) => stage.length > 0);
}

/** A node named "H" (case-insensitive) is a human confirmation gate. */
export function isHumanGate(node: string): boolean {
  return node.toUpperCase() === "H";
}

const inputSchema = z.object({
  flow: z
    .string()
    .describe(
      'Flow-DSL: "A, B -> C -> D". Comma separates parallel nodes in one stage; "->" separates sequential stages (relay). "H" is a human confirmation gate.',
    ),
  task: z
    .string()
    .describe("The initial task the whole pipeline is working toward."),
  types: z
    .record(
      z.string(),
      z.enum(TYPE_KEYS).describe("Subagent role for this node."),
    )
    .optional()
    .describe('Node name → subagent type. Missing nodes default to "general".'),
  aggregate: z
    .enum(["final", "list", "dict"])
    .optional()
    .describe(
      'How to aggregate step outputs into `final` (default "list"): "final"=last stage text, "list"=array of {node,summary}, "dict"=map of node→summary.',
    ),
});

type RunNodeOpts = {
  node: string;
  type: SubagentType;
  prompt: string;
  relay: string;
  apiKeys: Parameters<typeof runSubagent>[0]["keys"];
  selectedModelId: string;
  customEndpoints: Parameters<typeof runSubagent>[0]["customEndpoints"];
  customEndpointKeys: Parameters<typeof runSubagent>[0]["customEndpointKeys"];
  ctx: ToolContext;
  store: ReturnType<typeof useAgentActivityStore.getState>;
  group: string;
  depth: number;
  parentId?: string;
};

async function runNode(
  opts: RunNodeOpts,
): Promise<SwarmStepResult> {
  const actId = newActivityId();
  opts.store.start({
    id: actId,
    kind: "subagent",
    type: opts.type,
    prompt: opts.prompt,
    status: "running",
    step: null,
    startedAt: Date.now(),
    depth: opts.depth,
    parentId: opts.parentId,
    group: opts.group,
  });
  try {
    const r = await runSubagent({
      type: opts.type,
      prompt: opts.prompt,
      context: opts.relay,
      keys: opts.apiKeys,
      modelId: opts.selectedModelId,
      customEndpoints: opts.customEndpoints,
      customEndpointKeys: opts.customEndpointKeys,
      toolContext: opts.ctx,
      depth: opts.depth,
      parentId: actId,
      onStep: (label) => opts.store.updateStep(actId, label),
    });
    opts.store.finish(actId, r.summary, r.stepCount);
    return {
      node: opts.node,
      summary: r.summary,
      durationMs: r.durationMs,
      ok: true,
      stepCount: r.stepCount,
    };
  } catch (e) {
    opts.store.fail(actId, errText(e));
    return {
      node: opts.node,
      summary: "",
      durationMs: 0,
      ok: false,
      error: errText(e),
    };
  }
}

/** Run a stage's worker nodes in bounded waves (max 4 concurrent). */
async function runStage(
  nodes: string[],
  opts: Omit<RunNodeOpts, "node" | "type" | "prompt"> & {
    task: string;
    types?: Record<string, SubagentType>;
  },
): Promise<SwarmStepResult[]> {
  const results: SwarmStepResult[] = [];
  for (let i = 0; i < nodes.length; i += MAX_PARALLEL_WORKERS) {
    const wave = nodes.slice(i, i + MAX_PARALLEL_WORKERS);
    const settled = await Promise.allSettled(
      wave.map((node) => {
        const type = opts.types?.[node];
        const resolvedType: SubagentType =
          type && type in SUBAGENTS ? type : "general";
        return runNode({
          node,
          type: resolvedType,
          prompt: `You are the "${node}" stage of a multi-agent swarm pipeline.\n\nOverall task: ${opts.task}\n\nProduce the concrete deliverable for your "${node}" stage. Be terse and specific. Your final message MUST be a plain-text summary of your stage's output.`,
          relay: opts.relay,
          apiKeys: opts.apiKeys,
          selectedModelId: opts.selectedModelId,
          customEndpoints: opts.customEndpoints,
          customEndpointKeys: opts.customEndpointKeys,
          ctx: opts.ctx,
          store: opts.store,
          group: opts.group,
          depth: opts.depth,
          parentId: opts.parentId,
        });
      }),
    );
    settled.forEach((s, idx) => {
      if (s.status === "fulfilled") results.push(s.value);
      else
        results.push({
          node: wave[idx],
          summary: "",
          durationMs: 0,
          ok: false,
          error: errText(s.reason),
        });
    });
  }
  return results;
}

/** Build the relay context handed to the next stage. */
function buildRelay(steps: SwarmStepResult[]): string {
  return steps
    .filter((s) => !s.gate && s.ok && s.summary.trim().length > 0)
    .map((s) => `[From ${s.node}]\n${s.summary}`)
    .join("\n\n");
}

/** Aggregate step outputs according to the requested mode. */
function aggregateFinal(
  steps: SwarmStepResult[],
  aggregate: AggregateMode,
): string | SwarmStepSummary[] | Record<string, string> {
  const real = steps.filter((s) => !s.gate);
  switch (aggregate) {
    case "final": {
      const last = [...real].reverse().find((s) => s.ok && s.summary);
      return last ? last.summary : "";
    }
    case "dict": {
      const dict: Record<string, string> = {};
      for (const s of real) if (s.ok && s.summary) dict[s.node] = s.summary;
      return dict;
    }
    default:
      // "list" (default)
      return real.map((s) => ({ node: s.node, summary: s.summary }));
  }
}

/**
 * Build the swarm_flow tool. Describes a whole multi-agent pipeline in one
 * flow-DSL string and executes it with bounded parallelism, sequential
 * relaying, human gates, and per-`aggregate` summarization.
 */
export function buildSwarmFlowTools(ctx: ToolContext) {
  return {
    swarm_flow: tool({
      description: `Declaratively describe and run a multi-agent pipeline in one call. Use it to replace hand-written chains of delegate_many with a single flow-DSL string.

Flow DSL (flow param):
- "A, B -> C -> D" — comma = parallel nodes in one stage; "->" = sequential stages that relay each previous stage's output as the next one's context.
- "H" = human confirmation gate: it does NOT run a subagent; it is recorded in human_gates and returned so you can ask the user before proceeding.

Params:
- flow: the DSL string describing the whole pipeline.
- task: the initial task the pipeline works toward.
- types: optional node→subagent role map (default "general"). Roles:
${TYPE_KEYS.map((k) => `  - ${k}: ${SUBAGENTS[k].description}`).join("\n")}
- aggregate: "final"|"list"|"dict" (default "list") — how to summarize the pipeline output.

Parallelism within a stage is capped at ${MAX_PARALLEL_WORKERS} workers.`,
      inputSchema,
      // Writable stages (code/executor) require user approval up front.
      needsApproval: (input) => {
        const types = (input as { types?: Record<string, unknown> } | undefined)
          ?.types;
        return (
          !!types &&
          Object.values(types).some(
            (t) => t === "code" || t === "executor",
          )
        );
      },
      execute: async ({
        flow,
        task,
        types,
        aggregate = "list",
      }): Promise<SwarmFlowResult> => {
        const { apiKeys, selectedModelId, customEndpointKeys } =
          useChatStore.getState();
        const customEndpoints = usePreferencesStore.getState().customEndpoints;
        const store = useAgentActivityStore.getState();

        const depth = ctx.getSubagentDepth ? ctx.getSubagentDepth() : 0;
        const parentId = ctx.getParentActivityId
          ? ctx.getParentActivityId()
          : undefined;
        const group = `swarm-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;

        const stages = parseFlow(flow);
        if (stages.length === 0) {
          return {
            ok: false,
            steps: [],
            final: "",
            human_gates: [],
            aggregate,
            error: "empty flow: nothing to run",
          };
        }

        const baseOpts = {
          task,
          types,
          apiKeys,
          selectedModelId,
          customEndpoints,
          customEndpointKeys,
          ctx,
          store,
          group,
          depth: depth + 1,
          parentId,
        };

        const allSteps: SwarmStepResult[] = [];
        const humanGates: string[] = [];
        let relay = "";

        for (const stage of stages) {
          const workNodes: string[] = [];
          for (const node of stage) {
            if (isHumanGate(node)) {
              humanGates.push(node);
              allSteps.push({
                node,
                summary: "[human confirmation required]",
                durationMs: 0,
                ok: true,
                gate: true,
              });
            } else {
              workNodes.push(node);
            }
          }
          if (workNodes.length > 0) {
            const stageResults = await runStage(workNodes, {
              ...baseOpts,
              relay,
            });
            allSteps.push(...stageResults);
            relay = buildRelay(stageResults) || relay;
          }
        }

        return {
          ok: allSteps.every((s) => s.ok),
          steps: allSteps,
          final: aggregateFinal(allSteps, aggregate),
          human_gates: humanGates,
          aggregate,
        };
      },
    }),
  } as const;
}

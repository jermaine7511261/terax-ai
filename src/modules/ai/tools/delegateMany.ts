import { tool } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  MAX_SPAWN_DEPTH,
  runSubagent,
  SUBAGENT_SUMMARY_CAP,
} from "../agents/runSubagent";
import { SUBAGENTS, type SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import {
  newActivityId,
  useAgentActivityStore,
} from "../store/agentActivityStore";
import { createBudget, setActiveBudget, tryConsumeStep, refundStep } from "../lib/budget";
import type { ToolContext } from "./context";

/** Normalize an unknown thrown value to a readable error string. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const TYPE_KEYS = Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]];

/** Parallel worker cap (hermes/grok concurrency limit). */
export const MAX_PARALLEL_WORKERS = 4;

/** Per-worker step budget for delegate_many (hermes 父/子 budget缩小版). */
export const WORKER_STEP_BUDGET = 8;

export type DelegateWorkerResult = {
  type: SubagentType;
  prompt: string;
  ok: boolean;
  summary: string;
  error?: string;
  stepCount: number;
  durationMs: number;
};

export type DelegateManyResult = {
  ok: boolean;
  results: DelegateWorkerResult[];
  requested: number;
  spawned: number;
  depth: number;
  skipped: string[];
};

/**
 * Fan out a batch of isolated subagents in parallel and aggregate their
 * results back. Each worker runs in its own independent context (no shared
 * parent history) with a per-worker budget cap; workers beyond `MAX_SPAWN_DEPTH`
 * are refused to prevent infinite delegation. Concurrency is capped at
 * `MAX_PARALLEL_WORKERS`.
 */
export function buildDelegateManyTools(ctx: ToolContext) {
  return {
    delegate_many: tool({
      description: `Run MULTIPLE isolated subagents in parallel and aggregate their results. Use it when a task decomposes cleanly into independent sub-tasks (e.g. review three files, research three APIs) that can each be delegated to its own read-only worker. Each worker has its own fresh context and returns a single summary; you receive them all back. Pass one entry per independent sub-task with the subagent 'type' that fits it.

Types:
${TYPE_KEYS.map((k) => `- ${k}: ${SUBAGENTS[k].description}`).join("\n")}

Parallelism is capped at ${MAX_PARALLEL_WORKERS} workers; deeper nesting (beyond depth ${MAX_SPAWN_DEPTH}) is refused. Each worker's summary is capped at ${SUBAGENT_SUMMARY_CAP} chars.`,
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              type: z.enum(TYPE_KEYS),
              prompt: z
                .string()
                .describe(
                  "Self-contained instruction for this one worker. No shared history — include all needed context.",
                ),
              context: z
                .string()
                .optional()
                .describe(
                  "Optional isolated context to inject ahead of this worker's prompt (e.g. a prior step's output).",
                ),
            }),
          )
          .describe("List of independent sub-tasks to run in parallel."),
      }),
      // Read-only types auto-execute; writable types ask the user first.
      needsApproval: (input) => {
        const tasks = (input as { tasks?: { type?: unknown }[] } | undefined)
          ?.tasks;
        return (
          Array.isArray(tasks) &&
          tasks.some((t) => t.type === "code" || t.type === "executor")
        );
      },
      execute: async ({ tasks }): Promise<DelegateManyResult> => {
        const { apiKeys, selectedModelId, customEndpointKeys } =
          useChatStore.getState();
        const customEndpoints = usePreferencesStore.getState().customEndpoints;
        const store = useAgentActivityStore.getState();

        const depth = ctx.getSubagentDepth ? ctx.getSubagentDepth() : 0;
        const parentId = ctx.getParentActivityId
          ? ctx.getParentActivityId()
          : undefined;
        const group = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

        // Depth guard (invariant #3): refuse deeper delegation than allowed.
        const skipped: string[] = [];
        if (depth >= MAX_SPAWN_DEPTH) {
          for (const t of tasks) skipped.push(t.prompt.slice(0, 40));
          return {
            ok: false,
            results: [],
            requested: tasks.length,
            spawned: 0,
            depth,
            skipped,
          };
        }

        // Per-fan-out budget (hermes 子预算): refund on failure.
        const budget = createBudget({ max: WORKER_STEP_BUDGET });
        setActiveBudget(budget);

        // Simple semaphore: slice workers into waves of MAX_PARALLEL_WORKERS.
        const results: DelegateWorkerResult[] = [];
        const waves: typeof tasks[] = [];
        for (let i = 0; i < tasks.length; i += MAX_PARALLEL_WORKERS) {
          waves.push(tasks.slice(i, i + MAX_PARALLEL_WORKERS));
        }

        for (const wave of waves) {
          const settled = await Promise.allSettled(
            wave.map((t) => runWorker(t, { apiKeys, selectedModelId, customEndpoints, customEndpointKeys, ctx, store, group, depth, parentId })),
          );
          settled.forEach((s, i) => {
            const t = wave[i];
            if (s.status === "fulfilled") {
              results.push(s.value);
            } else {
              const reason = s.reason as unknown;
              results.push({
                type: t.type,
                prompt: t.prompt,
                ok: false,
                summary: "",
                error: errText(reason),
                stepCount: 0,
                durationMs: 0,
              });
            }
          });
        }

        setActiveBudget(null);
        return {
          ok: results.every((r) => r.ok),
          results,
          requested: tasks.length,
          // Only count workers that actually ran (budget-rejected ones never
          // spawned a subagent — they return a synthetic failure result).
          spawned: results.filter((r) => !r.error?.includes("budget exhausted")).length,
          depth,
          skipped,
        };
      },
    }),
  } as const;
}

type WorkerCtx = {
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

async function runWorker(
  t: { type: SubagentType; prompt: string; context?: string },
  wc: WorkerCtx,
): Promise<DelegateWorkerResult> {
  if (!tryConsumeStep()) {
    // Do NOT refund here: consume() failed, so the budget wasn't taken. A
    // refund would roll `used` back and let the next worker through, turning
    // the cap into "every other worker is rejected".
    return {
      type: t.type,
      prompt: t.prompt,
      ok: false,
      summary: "",
      error: "worker budget exhausted",
      stepCount: 0,
      durationMs: 0,
    };
  }
  const actId = newActivityId();
  wc.store.start({
    id: actId,
    kind: "subagent",
    type: t.type,
    prompt: t.prompt,
    status: "running",
    step: null,
    startedAt: Date.now(),
    depth: wc.depth + 1,
    parentId: wc.parentId,
    group: wc.group,
  });
  try {
    const r = await runSubagent({
      type: t.type,
      prompt: t.prompt,
      context: t.context,
      keys: wc.apiKeys,
      modelId: wc.selectedModelId,
      customEndpoints: wc.customEndpoints,
      customEndpointKeys: wc.customEndpointKeys,
      toolContext: wc.ctx,
      depth: wc.depth + 1,
      parentId: actId,
      onStep: (label) => wc.store.updateStep(actId, label),
    });
    wc.store.finish(actId, r.summary, r.stepCount);
    return {
      type: t.type,
      prompt: t.prompt,
      ok: true,
      summary: r.summary,
      stepCount: r.stepCount,
      durationMs: r.durationMs,
    };
  } catch (e) {
    refundStep();
    wc.store.fail(actId, errText(e));
    return {
      type: t.type,
      prompt: t.prompt,
      ok: false,
      summary: "",
      error: errText(e),
      stepCount: 0,
      durationMs: 0,
    };
  }
}

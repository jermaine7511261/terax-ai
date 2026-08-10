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

/** Parallel worker cap (/ concurrency limit). */
export const MAX_PARALLEL_WORKERS = 4;

/** Per-worker step budget for delegate_many ( 父/子 budget缩小版). */
const WORKER_STEP_BUDGET = 8;

export type DelegateWorkerResult = {
  type: SubagentType;
  prompt: string;
  ok: boolean;
  summary: string;
  error?: string;
  stepCount: number;
  durationMs: number;
  /** True when the worker was force-killed by the outer timeout and the
   *  summary only reflects progress made up to that point. */
  partial?: boolean;
  /** Last completed step label, for diagnosis on failure. */
  lastStep?: string | null;
};

export type DelegateManyResult = {
  ok: boolean;
  results: DelegateWorkerResult[];
  requested: number;
  spawned: number;
  depth: number;
  skipped: string[];
  /** Optional aggregated view (only when aggregate != "all"): a string for
   *  'final'/'list' or a {type: summary} map for 'dict'. */
  aggregated?: string | Record<string, string> | null;
  /** Sub-session id created for this fan-out's worker tree (P2-2 parentID). */
  subSessionId?: string | null;
};

/** Stable dedupe key for a task: type + prompt + context. When the raw key is
 *  very long, it is length-capped and mixed through an FNV-1a-style hash so
 *  identical big prompts still dedupe without oversized keys (no new deps). */
function dedupeKey(t: { type: string; prompt: string; context?: string }): string {
  const raw = `${t.type}\u0000${t.prompt}\u0000${t.context ?? ""}`;
  if (raw.length <= 512) return raw;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${raw.slice(0, 64)}::${raw.length}::${h >>> 0}`;
}

/** Effective concurrency: clamp the optional override to [1, 8], defaulting to
 *  MAX_PARALLEL_WORKERS so behavior is unchanged when omitted. */
function clampConcurrency(maxConcurrent?: number): number {
  if (typeof maxConcurrent !== "number" || Number.isNaN(maxConcurrent)) {
    return MAX_PARALLEL_WORKERS;
  }
  return Math.min(8, Math.max(1, Math.round(maxConcurrent)));
}

/** Build the aggregated payload for aggregate != "all" (semantics mirror the
 *  swarms-rs rearrange strategies: Final/List/Dict). */
function buildAggregation(
  aggregate: "final" | "list" | "dict",
  results: DelegateWorkerResult[],
): string | Record<string, string> | null {
  const ok = results.filter((r) => r.ok);
  if (aggregate === "final") {
    return ok.length > 0 ? ok[ok.length - 1].summary : null;
  }
  if (aggregate === "list") {
    return ok.map((r) => `[${r.type}] ${r.summary}`).join("\n");
  }
  const map: Record<string, string> = {};
  for (const r of ok) map[r.type] = r.summary; // last successful wins per type
  return map;
}

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

Parallelism is capped at ${MAX_PARALLEL_WORKERS} workers by default (override via 'max_concurrent', 1-8); deeper nesting (beyond depth ${MAX_SPAWN_DEPTH}) is refused. Each worker's summary is capped at ${SUBAGENT_SUMMARY_CAP} chars. Set 'dedupe' to drop tasks whose (type, prompt, context) repeat an earlier task. Choose an 'aggregate' strategy to collapse the results instead of returning the full array.`,
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
        max_concurrent: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe(
            "Optional concurrency cap: max workers running simultaneously (1-8, default 4). Larger batches are sliced into waves of this width.",
          ),
        dedupe: z
          .boolean()
          .optional()
          .describe(
            "Optional: when true, drop tasks whose (type, prompt, context) match an earlier task. Duplicates are skipped (not executed) and listed in 'skipped'. Default false.",
          ),
        aggregate: z
          .enum(["all", "final", "list", "dict"])
          .optional()
          .describe(
            "Optional result aggregation strategy. 'all' (default) returns the full 'results' array. 'final' returns the last successful summary as a string. 'list' joins every successful summary as '[type] summary' lines. 'dict' returns a {type: summary} map (last wins per type). The aggregated value (if any) is exposed on 'aggregated'.",
          ),
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
      execute: async ({
        tasks,
        max_concurrent,
        dedupe,
        aggregate,
      }): Promise<DelegateManyResult> => {
        const { apiKeys, selectedModelId, customEndpointKeys } =
          useChatStore.getState();
        const customEndpoints = usePreferencesStore.getState().customEndpoints;
        const store = useAgentActivityStore.getState();
        const chatStore = useChatStore.getState();

        const depth = ctx.getSubagentDepth ? ctx.getSubagentDepth() : 0;
        const parentId = ctx.getParentActivityId
          ? ctx.getParentActivityId()
          : undefined;
        const group = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

        // P2-2 parentID session tree: this fan-out is materialized as a real
        // sub-session under the current main session, so the worker tree is
        // visible/selectable in the session bar ( parentID semantics).
        const currentSessionId = chatStore.activeSessionId;
        const subSessionId = currentSessionId
          ? chatStore.createSubSession(
              chatStore.resolveRootSessionId(currentSessionId),
              `Workers · ${tasks.length}`,
            )
          : null;
        const subCtx = subSessionId
          ? { ...ctx, getSessionId: () => subSessionId }
          : ctx;

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
            subSessionId: null,
          };
        }

        // Per-fan-out budget ( 子预算): refund on failure.
        const budget = createBudget({ max: WORKER_STEP_BUDGET });
        setActiveBudget(budget);

        // Optional dedupe: drop tasks whose (type, prompt, context) key matches
        // an earlier task. Duplicates never run and are surfaced in `skipped`.
        let tasksToRun: typeof tasks = tasks;
        if (dedupe) {
          const seen = new Set<string>();
          const kept: typeof tasks = [];
          for (const t of tasks) {
            const key = dedupeKey(t);
            if (seen.has(key)) {
              skipped.push(t.prompt.slice(0, 40));
            } else {
              seen.add(key);
              kept.push(t);
            }
          }
          tasksToRun = kept;
        }

        // Dynamic concurrency pool: slice workers into waves of the effective
        // concurrency (default MAX_PARALLEL_WORKERS, overridable via max_concurrent).
        const concurrency = clampConcurrency(max_concurrent);
        const results: DelegateWorkerResult[] = [];
        const waves: typeof tasks[] = [];
        for (let i = 0; i < tasksToRun.length; i += concurrency) {
          waves.push(tasksToRun.slice(i, i + concurrency));
        }

        for (const wave of waves) {
          const settled = await Promise.allSettled(
            wave.map((t) => runWorker(t, { apiKeys, selectedModelId, customEndpoints, customEndpointKeys, ctx: subCtx, store, group, depth, parentId })),
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
        const base: DelegateManyResult = {
          ok: results.every((r) => r.ok),
          results,
          requested: tasks.length,
          // Only count workers that actually ran (budget-rejected ones never
          // spawned a subagent — they return a synthetic failure result).
          spawned: results.filter((r) => !r.error?.includes("budget exhausted")).length,
          depth,
          skipped,
          subSessionId,
        };
        const agg = aggregate ?? "all";
        if (agg !== "all") {
          return { ...base, aggregated: buildAggregation(agg, results) };
        }
        return base;
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

/** Per-worker wall-clock cap ( worker timeout): a stuck subagent must
 *  not hang the whole fan-out wave. Generous vs. SUBAGENT_TOTAL_TIMEOUT_MS
 *  plus tool round-trips. */
const WORKER_TIMEOUT_MS = 7 * 60 * 1000;

async function runWorker(
  t: { type: SubagentType; prompt: string; context?: string },
  wc: WorkerCtx,
): Promise<DelegateWorkerResult> {
  // Accumulate completed-step labels so a timeout/failure surfaces the work
  // the worker actually did instead of an opaque error (partial-result
  // transparency: 7 minutes of progress is not discarded).
  const progress: string[] = [];
  const inner = runWorkerInner(t, wc, progress);
  // Outer timeout: even if runSubagent's internal timeouts are misconfigured
  // or a tool never resolves, the wave always completes.
  return Promise.race([
    inner,
    new Promise<DelegateWorkerResult>((resolve) => {
      setTimeout(
        () =>
          resolve({
            type: t.type,
            prompt: t.prompt,
            ok: false,
            summary:
              progress.length > 0
                ? `partial progress (${progress.length} steps): ${progress.join(" → ")}`
                : "no steps completed before timeout",
            error: "worker timed out",
            stepCount: progress.length,
            durationMs: 0,
            partial: true,
            lastStep: progress[progress.length - 1] ?? null,
          }),
        WORKER_TIMEOUT_MS,
      );
    }),
  ]);
}

async function runWorkerInner(
  t: { type: SubagentType; prompt: string; context?: string },
  wc: WorkerCtx,
  progress: string[],
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
      onStep: (label) => {
        progress.push(label);
        wc.store.updateStep(actId, label);
      },
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
      stepCount: progress.length,
      durationMs: 0,
      lastStep: progress[progress.length - 1] ?? null,
    };
  }
}

/**
 * Loop engineering helpers (P1-1, L2). Pure functions for the think-act-observe
 * cycle: phase tracking, robust exit detection (opencode), and doom-loop
 * detection (opencode processor.ts). No platform deps — unit-tested.
 */

export type LoopPhase = "thinking" | "calling" | "observing" | "done";

export type RecentToolCall = {
  toolName: string;
  args: string;
};

/** Returns the phase transition for a finished step. */
export function phaseForStep(step: {
  toolCalls?: { toolName?: string; input?: unknown }[];
  text?: string;
}): LoopPhase {
  if (step.toolCalls && step.toolCalls.length > 0) return "calling";
  if (step.text) return "observing";
  return "thinking";
}

/**
 * Robust exit (opencode: `finish !== tool-calls && no pending tool`): a loop
 * should only terminate when the model stopped WITHOUT a pending tool call.
 * If the finish reason is a tool-call handoff, the run must continue.
 */
export function shouldExitLoop(opts: {
  finishReason: string;
  hasPendingToolCall: boolean;
  stepsSeen: number;
  maxSteps: number;
}): boolean {
  // Step cap is always a hard stop.
  if (opts.stepsSeen >= opts.maxSteps) return true;
  // A pending tool call means we MUST continue to observe the result.
  if (opts.hasPendingToolCall) return false;
  // Otherwise trust the finish reason — any non-tool-call stop is terminal.
  const fr = opts.finishReason;
  if (fr === "tool-calls" || fr === "tool-call") return false;
  return true;
}

/**
 * Robust-exit stop condition (opencode robust loop exit): a real
 * `stopWhen` predicate for the AI SDK built on {@link shouldExitLoop}. It
 * composes with `stepCountIs(maxSteps)` so the loop both caps steps AND stops
 * as soon as the model has no pending tool call to observe — instead of
 * trusting a possibly-stale `stop_reason` alone. `maxSteps` must match the
 * `stepCountIs` cap so the two don't conflict.
 */
export function robustExitStopCondition(maxSteps: number) {
  return (opts: {
    steps: ReadonlyArray<{
      finishReason?: string;
      toolCalls?: unknown[];
      toolResults?: unknown[];
    }>;
  }): boolean => {
    const last = opts.steps[opts.steps.length - 1];
    if (!last) return true; // no steps — nothing to continue
    const pendingToolCalls = (last.toolCalls ?? []).length > (last.toolResults ?? []).length;
    return shouldExitLoop({
      finishReason: last.finishReason ?? "",
      hasPendingToolCall: pendingToolCalls,
      stepsSeen: opts.steps.length,
      maxSteps,
    });
  };
}

/**
 * Doom-loop detection (opencode processor.ts: last 3 tool parts with the same
 * tool + same args → the agent is stuck repeating itself). Returns true when
 * a detection should trigger (ask the user / terminate).
 */
export function detectDoomLoop(
  recent: RecentToolCall[],
  windowSize = 3,
): boolean {
  if (recent.length < windowSize) return false;
  const last = recent.slice(-windowSize);
  const first = last[0];
  return last.every(
    (t) => t.toolName === first.toolName && t.args === first.args,
  );
}

/** Push a tool call onto the rolling window (cap the array size). */
export function pushToolCall(
  recent: RecentToolCall[],
  call: RecentToolCall,
  maxLen = 12,
): RecentToolCall[] {
  const next = [...recent, call];
  return next.length > maxLen ? next.slice(next.length - maxLen) : next;
}

/**
 * Doom-loop recovery (S1, PraisonAI): escalation ladder — detecting a loop is
 * only half the fix; the agent must change path. Produces a steering message
 * that escalates with consecutive detections:
 *   1. Change tool/path.
 *   2. Change overall approach (stop hammering the same tool).
 *   3. Stop and ask the user (can't self-resolve).
 * `detections` = consecutive doom-loop hits so far (0 on the first).
 */
export function recoveryNudge(detections: number): {
  severity: "tool" | "approach" | "ask";
  message: string;
} {
  if (detections <= 0) {
    return {
      severity: "tool",
      message:
        "You appear to be repeating the same tool call. Try a different path, tool, or check whether the goal is already met, then respond.",
    };
  }
  if (detections === 1) {
    return {
      severity: "approach",
      message:
        "You are still repeating yourself. Stop calling the same tool with the same arguments. Re-read what you already have and take a fundamentally different approach or summarize what you know.",
    };
  }
  return {
    severity: "ask",
    message:
      "You are stuck repeating the same action. Stop working and explain to the user what you've tried, what's blocking you, and ask how they'd like to proceed.",
  };
}

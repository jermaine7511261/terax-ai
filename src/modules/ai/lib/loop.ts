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

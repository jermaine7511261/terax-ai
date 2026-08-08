/**
 * Approval tri-state (P1-3, opencode Reply{once|always|reject} + cascade).
 * Upgrades the binary approve/deny into: ONCE (approve this one request),
 * ALWAYS (remember the tool/target + cascade-approve its descendants), REJECT
 * (deny, optionally with a message fed back to the model for correction).
 *
 * Pure state machine — no platform deps — unit-tested.
 */

export type ApprovalDecision = "once" | "always" | "reject";

export type ApprovalOutcome = {
  /** The decision the user made. */
  decision: ApprovalDecision;
  /** For reject: a message to feed back to the model (hermes nudge / opencode
   * RejectedError). Empty when none. */
  feedback: string;
};

export type ApprovalRequest = {
  /** Tool or target being approved (used as the "always" memory key). */
  target: string;
  /** A parent scope id: when the parent was ALWAYS-approved, a child request
   * sharing the scope is auto-approved (cascade). */
  scope: string;
};

export type ApprovalMemory = {
  /** Targets the user chose "always" for this session (cascade-approve). */
  always: Set<string>;
  /** Scopes the user chose "always" for (approve the whole subtree). */
  alwaysScopes: Set<string>;
};

export function createApprovalMemory(): ApprovalMemory {
  return { always: new Set<string>(), alwaysScopes: new Set<string>() };
}

/**
 * Resolve whether a request is auto-approved by prior "always" decisions,
 * BEFORE asking the user. Returns:
 *  - `{ auto: true, outcome: { decision: "always" } }` when it should be
 *    silently approved via cascade;
 *  - `{ auto: false }` when the user must be asked.
 */
export function resolveApproval(
  mem: ApprovalMemory,
  req: ApprovalRequest,
):
  | { auto: true; outcome: ApprovalOutcome }
  | { auto: false } {
  if (mem.always.has(req.target)) {
    return { auto: true, outcome: { decision: "always", feedback: "" } };
  }
  if (mem.alwaysScopes.has(req.scope)) {
    return { auto: true, outcome: { decision: "always", feedback: "" } };
  }
  return { auto: false };
}

/**
 * Record the user's tri-state decision. ALWAYS remembers the target (and its
 * scope) so subsequent requests with the same target/scope cascade-approve
 * without prompting. ONCE approves only this request. REJECT remembers nothing.
 * Returns the outcome (with optional reject feedback) to hand back.
 */
export function applyApproval(
  mem: ApprovalMemory,
  req: ApprovalRequest,
  decision: ApprovalDecision,
  feedback = "",
): ApprovalOutcome {
  if (decision === "always") {
    mem.always.add(req.target);
    mem.alwaysScopes.add(req.scope);
  }
  return { decision, feedback: decision === "reject" ? feedback : "" };
}

/** Forget all "always" memory (e.g. on session switch / window reset). */
export function resetApprovalMemory(mem: ApprovalMemory): void {
  mem.always.clear();
  mem.alwaysScopes.clear();
}

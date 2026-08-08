/**
 * Skill auto-curation (P1-5, hermes curator.py): a background lifecycle state
 * machine that MAINTAINS the existing agent-created skill set — pin frequently
 * used skills, archive stale ones, mark duplicates for consolidation — without
 * ever generating new skills or deleting anything (archive-only, pinned exempt).
 *
 * Pure functions — no platform deps — unit-tested. The actual background
 * trigger (inactivity check) lives in the caller.
 */

export type SkillLifecycle = {
  name: string;
  /** When this skill was last used / invoked (ms epoch). 0 = never used. */
  activityTs: number;
  /** How many times it has been invoked. Drives the pin decision. */
  usageCount: number;
  /** Whether the user pinned it (exempt from archive/consolidate). */
  pinned?: boolean;
  /** Whether it was agent-created (only these are curated). */
  agentCreated?: boolean;
  /** Current lifecycle status. */
  status: "active" | "archived";
};

export type CurateDecision =
  | { action: "keep"; name: string; reason: string }
  | { action: "pin"; name: string; reason: string }
  | { action: "archive"; name: string; reason: string }
  | { action: "consolidate"; name: string; reason: string };

export type CuratorConfig = {
  /** Archive skills unused longer than this (ms). */
  archiveAfterMs: number;
  /** Pin skills used at least this many times recently. */
  pinUsageThreshold: number;
  /** Only curate agent-created skills (hermes safety rule). */
  onlyAgentCreated: boolean;
};

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  archiveAfterMs: 30 * 24 * 60 * 60 * 1000, // 30 days unused
  pinUsageThreshold: 5,
  onlyAgentCreated: true,
};

/**
 * Decide the lifecycle action for a single skill based on its activity.
 * Safety invariants (hermes curator): pinned skills are NEVER archived or
 * consolidated; non-agent-created skills are left untouched when
 * `onlyAgentCreated` is on; nothing is ever deleted (archive is the terminal
 * state).
 */
export function curateSkill(
  skill: SkillLifecycle,
  now: number,
  config: CuratorConfig = DEFAULT_CURATOR_CONFIG,
): CurateDecision {
  if (config.onlyAgentCreated && !skill.agentCreated) {
    return { action: "keep", name: skill.name, reason: "not agent-created" };
  }
  if (skill.pinned) {
    return { action: "keep", name: skill.name, reason: "pinned" };
  }
  if (skill.status === "archived") {
    return { action: "keep", name: skill.name, reason: "already archived" };
  }
  const idle = now - skill.activityTs;
  // A skill used a LOT is worth pinning so the user can find it. Pinning is
  // driven by usage count, not mere recency.
  if (
    skill.usageCount >= config.pinUsageThreshold &&
    idle < config.archiveAfterMs
  ) {
    return { action: "pin", name: skill.name, reason: "high usage" };
  }
  if (skill.activityTs > 0 && idle > config.archiveAfterMs) {
    return { action: "archive", name: skill.name, reason: `idle ${idle}ms` };
  }
  return { action: "keep", name: skill.name, reason: "active" };
}

/**
 * Run curation over a whole skill set, returning the batch of decisions.
 * Pinned / non-agent-created skills are automatically filtered out (safety).
 */
export function curateSkills(
  skills: SkillLifecycle[],
  now: number,
  config: CuratorConfig = DEFAULT_CURATOR_CONFIG,
): CurateDecision[] {
  const out: CurateDecision[] = [];
  for (const s of skills) {
    const d = curateSkill(s, now, config);
    if (d.action !== "keep") out.push(d);
  }
  return out;
}

/**
 * Mark a skill as used (bump its activity timestamp + increment a usage count
 * rolled into activityTs). Returns the updated lifecycle record.
 */
export function touchSkill(
  skill: SkillLifecycle,
  now: number,
  usageCount: number,
): SkillLifecycle {
  return { ...skill, activityTs: now, usageCount, status: "active" };
}

/**
 * Whether a background curation pass should run now (inactivity-triggered).
 * Runs at most once per `intervalMs`, and only after at least `idleBeforeMs`
 * of no curation activity (hermes: no cron daemon, triggered by idle).
 */
export function shouldRunCurator(opts: {
  lastRunAt: number;
  now: number;
  intervalMs: number;
}): boolean {
  return opts.now - opts.lastRunAt >= opts.intervalMs;
}

/**
 * Apply a curation decision to a skill.json payload by writing back the
 * resulting lifecycle state. Only the `archive` decision mutates the file
 * (sets `archived:true`); pin/keep are advisory and just reported. Returns the
 * updated payload, or null when the decision is a no-op.
 *
 * File I/O is injected via `fs` so this stays testable without the platform.
 */
export function applyCurateDecision(
  payload: Record<string, unknown>,
  decision: CurateDecision,
): Record<string, unknown> | null {
  if (decision.action === "archive") {
    return { ...payload, archived: true };
  }
  return null;
}

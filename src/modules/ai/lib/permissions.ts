/**
 * Permission system for AI agents.
 * Inspired by OpenCode's permision model: allow/ask/deny + glob pattern matching.
 *
 * Each agent (Build, Plan, or custom) has its own set of permission rules.
 * Rules are evaluated in order, with later rules taking priority (findLast wins).
 * Default fallback is "ask" — safe by default.
 */

import { match } from "./wildcard";

// ─── Types ────────────────────────────────────────────────────────────

/** The effect of a permission rule. */
export type PermissionEffect = "allow" | "ask" | "deny";

/** A single permission rule. */
export type PermissionRule = {
  /** Action pattern (e.g. "read", "edit", "bash", "git *") */
  action: string;
  /** Resource pattern (e.g. "*", "src/** /", "*.env") */
  resource: string;
  /** What to do when this rule matches */
  effect: PermissionEffect;
};

/** A set of permission rules for an agent. */
export type PermissionRuleset = PermissionRule[];

/** Known permission action keys. */
export type PermissionAction =
  | "read"
  | "edit"
  | "bash"
  | "glob"
  | "grep"
  | "list"
  | "task"
  | "memory"
  | "cron"
  | "web_search"
  | "web_fetch"
  | "todowrite"
  | "question"
  | "skill"
  | "lsp"
  | string; // Allow custom actions via glob patterns

/**
 * Result of a permission check.
 */
export type PermissionCheck = {
  allowed: boolean;
  effect: PermissionEffect;
  matchedRule: PermissionRule | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve `~`/`$HOME` in a resource path.
 * Only expands leading `~` or `$HOME`.
 */
export function expandPath(resource: string, homeDir: string): string {
  return resource
    .replace(/^~(?:\/|\\|$)/, `${homeDir}/`)
    .replace(/^\$HOME(?:\/|\\|$)/, `${homeDir}/`);
}

// ─── Core evaluation ──────────────────────────────────────────────────

const DEFAULT_RULE: PermissionRule = {
  action: "*",
  resource: "*",
  effect: "ask",
};

/**
 * Evaluate an action + resource against a set of permission rulesets.
 *
 * Rules are checked in order across all rulesets; the **last** matching rule
 * wins (findLast semantics). This allows:
 *  - Global defaults first, then per-project overrides
 *  - Deny some paths, allow specific subpaths
 *
 * If no rule matches, defaults to "ask" (safe).
 *
 * @param action - The action being taken (e.g. "edit", "bash", "git push")
 * @param resource - The resource being acted on (e.g. file path, command)
 * @param rulesets - One or more arrays of PermissionRule
 * @returns The matching rule (or the default "ask" rule)
 */
export function evaluate(
  action: string,
  resource: string,
  ...rulesets: PermissionRuleset[]
): PermissionRule {
  const allRules = rulesets.flat();
  const matched = allRules.findLast(
    (rule) => match(action, rule.action) && match(resource, rule.resource),
  );
  return matched ?? DEFAULT_RULE;
}

/**
 * Check if an action is allowed on a resource.
 * Returns detailed info including which rule matched.
 */
export function check(
  action: string,
  resource: string,
  ...rulesets: PermissionRuleset[]
): PermissionCheck {
  const matchedRule = evaluate(action, resource, ...rulesets);
  return {
    allowed: matchedRule.effect === "allow",
    effect: matchedRule.effect,
    matchedRule,
  };
}

/**
 * Assert that an action is allowed on a resource.
 * Throws if denied; returns the effect if ask (caller should prompt user).
 */
export function assert(
  action: string,
  resource: string,
  ...rulesets: PermissionRuleset[]
): PermissionEffect {
  const result = check(action, resource, ...rulesets);
  if (result.effect === "deny") {
    throw new PermissionDeniedError(action, resource, result.matchedRule!);
  }
  return result.effect;
}

// ─── Agent permissions presets ────────────────────────────────────────

/** Default ruleset for the Build agent: full access, ask for dangerous ops. */
export const BUILD_PERMISSIONS: PermissionRuleset = [
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "list", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "allow" },
  { action: "bash", resource: "*", effect: "allow" },
  { action: "bash", resource: "git *", effect: "allow" }, // Common git ops auto-allowed
  { action: "bash", resource: "npm *", effect: "allow" },
  { action: "bash", resource: "pnpm *", effect: "allow" },
  { action: "bash", resource: "cargo *", effect: "allow" },
  { action: "bash", resource: "ls *", effect: "allow" },
  { action: "bash", resource: "cat *", effect: "allow" },
  { action: "bash", resource: "cd *", effect: "allow" },
  { action: "bash", resource: "mkdir *", effect: "allow" },
  { action: "bash", resource: "cp *", effect: "allow" },
  { action: "bash", resource: "mv *", effect: "allow" },
  { action: "bash", resource: "rm *", effect: "ask" }, // Deletion requires confirmation
  { action: "bash", resource: "rm -rf *", effect: "deny" }, // Force delete always denied
  { action: "bash", resource: "sudo *", effect: "ask" },
  { action: "bash", resource: "curl * | sh", effect: "deny" },
  { action: "bash", resource: "curl * | bash", effect: "deny" },
  { action: "task", resource: "*", effect: "allow" },
  { action: "memory", resource: "*", effect: "allow" },
  { action: "cron", resource: "*", effect: "allow" },
  { action: "skill", resource: "*", effect: "allow" },
  { action: "web_search", resource: "*", effect: "allow" },
  { action: "web_fetch", resource: "*", effect: "allow" },
  { action: "todowrite", resource: "*", effect: "allow" },
  { action: "question", resource: "*", effect: "allow" },
  { action: "lsp", resource: "*", effect: "allow" },
];

/** Default ruleset for the Plan agent: read-only, no mutations. */
export const PLAN_PERMISSIONS: PermissionRuleset = [
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "list", resource: "*", effect: "allow" },
  { action: "lsp", resource: "*", effect: "allow" },
  // Everything else is denied by default for Plan mode
  { action: "edit", resource: "*", effect: "deny" },
  { action: "bash", resource: "*", effect: "ask" },
  { action: "bash", resource: "npm *", effect: "deny" },
  { action: "bash", resource: "pnpm *", effect: "deny" },
  { action: "bash", resource: "cargo *", effect: "deny" },
  { action: "task", resource: "*", effect: "deny" },
  { action: "memory", resource: "*", effect: "ask" },
  { action: "cron", resource: "*", effect: "deny" },
  { action: "skill", resource: "*", effect: "deny" },
  { action: "web_search", resource: "*", effect: "allow" },
  { action: "web_fetch", resource: "*", effect: "allow" },
  { action: "todowrite", resource: "*", effect: "allow" },
];

/** Default ruleset for subagents: read-only, no network. */
export const SUBAGENT_PERMISSIONS: PermissionRuleset = [
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
  { action: "list", resource: "*", effect: "allow" },
  { action: "edit", resource: "*", effect: "deny" },
  { action: "bash", resource: "*", effect: "deny" },
  { action: "web_search", resource: "*", effect: "deny" },
  { action: "web_fetch", resource: "*", effect: "deny" },
  { action: "todowrite", resource: "*", effect: "deny" },
];

// ─── Error ────────────────────────────────────────────────────────────

export class PermissionDeniedError extends Error {
  constructor(
    public readonly action: string,
    public readonly resource: string,
    public readonly rule: PermissionRule,
  ) {
    super(
      `Permission denied: ${action} on ${resource} ` +
        `(matched rule: ${rule.action} → ${rule.resource} = ${rule.effect})`,
    );
    this.name = "PermissionDeniedError";
  }
}

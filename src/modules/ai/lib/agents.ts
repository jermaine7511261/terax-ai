import { createStorage } from "@/platform";
import { tStatic } from "@/lib/i18n";

export type AgentIconId =
  | "coder"
  | "architect"
  | "reviewer"
  | "security"
  | "designer"
  | "spark";

/** Agent visibility mode ( agent schema): where the agent is offered. */
type AgentMode = "subagent" | "primary" | "all";

/** Tool visibility scope (R28 #1 AgentDef). */
export type ToolScope =
  | { kind: "all" }
  | { kind: "allowList"; value: string[] }
  | { kind: "denyList"; value: string[] }
  | { kind: "named"; value: string };

/** Per-agent memory behavior (R28 #1). */
export type AgentMemoryConfig = {
  recall: boolean;
  autoSave: boolean;
  scope: "session" | "workspace" | "global";
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  icon: AgentIconId;
  builtIn: boolean;
  /**
   * Where this agent may be selected (P1-0 /  `mode`):
   *  - "primary" = the main chat agent picker only
   *  - "subagent" = only as a delegated worker
   *  - "all" = both (default for user-created agents)
   */
  mode?: AgentMode;
  /**
   * Run but hide from selectors ( `hidden`). Used for internal/system
   * agents (e.g. a compaction agent) that can run but shouldn't clutter the UI.
   */
  hidden?: boolean;
  /** R28 #1: model override (None = inherit the main agent). */
  model?: string;
  /** R28 #1: reasoning depth override. */
  reasoningEffort?: "off" | "low" | "medium" | "high";
  /** R28 #1: step cap (default 24). */
  maxSteps?: number;
  /** R28 #1: token cap. */
  maxTokens?: number;
  /** R28 #1: cost cap in USD. */
  budgetCap?: number;
  /** R28 #1: tool visibility scope (default all). */
  toolScope?: ToolScope;
  /** R28 #1: per-agent color badge. */
  color?: string;
};

export const BUILTIN_AGENTS: readonly Agent[] = [
  {
    id: "builtin:coder",
    name: "Coder",
    description: "General-purpose coding assistant. Writes, edits, and runs.",
    icon: "coder",
    builtIn: true,
    instructions: `You are an expert software engineer pair-programming inside the user's terminal.
- Read files before editing them. Match existing patterns and naming.
- Prefer the smallest correct change. Don't refactor adjacent code unprompted.
- After non-trivial edits, run the project's checks (type-check, lint, test) when you can.
- Keep responses tight: short prose, code blocks with language fences.`,
  },
  {
    id: "builtin:architect",
    name: "Architect",
    description: "Design and tradeoffs. Plans before code.",
    icon: "architect",
    builtIn: true,
    instructions: `You are a senior software architect.
- Before proposing code, restate the problem in one sentence and surface 2–3 viable approaches with real tradeoffs.
- Recommend one with reasoning. Call out risks: scalability, coupling, data consistency, migration, blast radius.
- Reference the actual repo (read key files) before generalizing. No hand-wavy advice.
- Output structure: Problem · Options · Recommendation · Risks · Next steps.`,
  },
  {
    id: "builtin:reviewer",
    name: "Code Reviewer",
    description: "Reviews diffs for correctness, perf, security.",
    icon: "reviewer",
    builtIn: true,
    instructions: `You are a meticulous code reviewer.
- Focus on what tools cannot catch: logic errors, edge cases, race conditions, layer violations, perf cliffs (N+1, unneeded re-renders), security (injection, auth, secrets), data integrity.
- Skip formatting / naming / inferred-type nits — linters handle those.
- Output: \`[MUST/SHOULD/NIT] file:line — issue → fix\`. If nothing real, say "Looks good."
- Verify each finding against the actual file before reporting it.`,
  },
  {
    id: "builtin:security",
    name: "Security",
    description: "Threat-models changes and flags vulns.",
    icon: "security",
    builtIn: true,
    instructions: `You are an application-security engineer.
- Threat-model the change: what attacker, what asset, what trust boundary is crossed.
- Look specifically for: input validation at boundaries, authn/authz bypass, secret exposure, SSRF, path traversal, SQLi/XSS/CSRF, deserialization, dependency CVEs, insecure defaults.
- For each finding: severity, exploit sketch, concrete fix. Prefer fixes that close the class of bug, not the one report.
- If the change is benign, say so explicitly — don't fabricate findings.`,
  },
  {
    id: "builtin:designer",
    name: "Designer",
    description: "UI/UX critique and refinement.",
    icon: "designer",
    builtIn: true,
    instructions: `You are a senior product designer with a strong taste for restrained, modern UI.
- Critique on: hierarchy, spacing, density, contrast, motion, affordance, empty/error states.
- Propose concrete changes, with Tailwind/CSS values when helpful. Keep consistent with the surrounding design system.
- Avoid generic "make it pop" advice. Be specific about what's wrong and why.`,
  },
] as const;

/** Localized display name for a built-in agent (custom agents use their stored name). */
export function agentDisplayName(agent: Agent): string {
  if (!agent.builtIn) return agent.name;
  const map: Record<string, string> = {
    "builtin:coder": tStatic("agents.coderName"),
    "builtin:architect": tStatic("agents.architectName"),
    "builtin:reviewer": tStatic("agents.reviewerName"),
    "builtin:security": tStatic("agents.securityName"),
    "builtin:designer": tStatic("agents.designerName"),
    "builtin:spark": agent.name,
  };
  return map[agent.id] ?? agent.name;
}

/** Localized description for a built-in agent (custom agents use their stored description). */
export function agentDisplayDescription(agent: Agent): string {
  if (!agent.builtIn) return agent.description;
  const map: Record<string, string> = {
    "builtin:coder": tStatic("agents.coderDesc"),
    "builtin:architect": tStatic("agents.architectDesc"),
    "builtin:reviewer": tStatic("agents.reviewerDesc"),
    "builtin:security": tStatic("agents.securityDesc"),
    "builtin:designer": tStatic("agents.designerDesc"),
    "builtin:spark": agent.description,
  };
  return map[agent.id] ?? agent.description;
}

const STORE_PATH = "yamet-ai-agents.json";
const KEY_CUSTOM = "customAgents";
const KEY_ACTIVE = "activeAgentId";

const store = createStorage(STORE_PATH);

export type LoadedAgents = {
  custom: Agent[];
  activeId: string;
};

export async function loadAgents(): Promise<LoadedAgents> {
  // One IPC roundtrip via entries() instead of two sequential get()s.
  const entries = await store.entries();
  let custom: Agent[] | undefined;
  let activeId: string | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_CUSTOM) custom = v as Agent[];
    else if (k === KEY_ACTIVE) activeId = v as string;
  }
  return { custom: custom ?? [], activeId: activeId ?? BUILTIN_AGENTS[0].id };
}

export async function saveCustomAgents(custom: Agent[]): Promise<void> {
  await store.set(KEY_CUSTOM, custom);
}

export async function saveActiveAgentId(id: string): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export function newAgentId(): string {
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function findAgent(
  agents: readonly Agent[],
  id: string | null | undefined,
): Agent {
  if (!id) return BUILTIN_AGENTS[0];
  return agents.find((a) => a.id === id) ?? BUILTIN_AGENTS[0];
}

/**
 * Merge user-provided agent overrides onto the builtin set (P1-0 / 
 * ConfigV2 semantics): a user agent with the same `name` as a builtin overrides
 * it (same-name override); `disabled: true` removes the builtin of that name;
 * otherwise the user agent is appended as a new custom agent. Returns a fresh
 * array — pure, unit-tested.
 */
export type AgentOverride = Partial<Omit<Agent, "id">> & {
  name: string;
  /** Set true to remove a builtin of the same name ( `disable`). */
  disabled?: boolean;
};

export function mergeAgentOverrides(
  builtins: readonly Agent[],
  overrides: readonly AgentOverride[],
): Agent[] {
  const out: Agent[] = builtins.map((a) => ({ ...a }));
  for (const ov of overrides) {
    const idx = out.findIndex((a) => a.name.toLowerCase() === ov.name.toLowerCase());
    if (ov.disabled) {
      if (idx !== -1) out.splice(idx, 1);
      continue;
    }
    const base = idx !== -1 ? out[idx] : null;
    const merged: Agent = {
      id: base?.id ?? `custom:${ov.name}`,
      name: ov.name,
      description: ov.description ?? base?.description ?? "",
      instructions: ov.instructions ?? base?.instructions ?? "",
      icon: ov.icon ?? base?.icon ?? "spark",
      builtIn: !!base,
      mode: ov.mode ?? base?.mode,
      hidden: ov.hidden ?? base?.hidden,
      model: ov.model ?? base?.model,
      reasoningEffort: ov.reasoningEffort ?? base?.reasoningEffort,
      maxSteps: ov.maxSteps ?? base?.maxSteps,
      maxTokens: ov.maxTokens ?? base?.maxTokens,
      budgetCap: ov.budgetCap ?? base?.budgetCap,
      toolScope: ov.toolScope ?? base?.toolScope,
      color: ov.color ?? base?.color,
    };
    if (idx !== -1) out[idx] = merged;
    else out.push(merged);
  }
  return out;
}

/** Agents a primary (main-chat) picker should offer: not hidden + not subagent-only. */
export function selectablePrimaryAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter(
    (a) => !a.hidden && a.mode !== "subagent",
  );
}

/** Agents a delegated-worker picker should offer: not hidden + not primary-only. */
export function selectableSubagentAgents(agents: readonly Agent[]): Agent[] {
  return agents.filter(
    (a) => !a.hidden && a.mode !== "primary",
  );
}

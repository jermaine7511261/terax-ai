/**
 * Agent Registry — defines all agent types, their roles, and tool access.
 *
 * Architecture inspired by OpenCode's agent system:
 *  - **Build agent**: Full-access, default mode for development work.
 *  - **Plan agent**: Read-only analysis mode. Tab to switch.
 *  - **Subagents**: invoked via @mention in composer, scoped tool sets.
 *  - **External agents**: Detected via OSC 777 hooks (Claude Code, Codex, etc.)
 */

import type { PermissionRuleset } from "../lib/permissions";
import {
  BUILD_PERMISSIONS,
  PLAN_PERMISSIONS,
  SUBAGENT_PERMISSIONS,
} from "../lib/permissions";

// ─── Agent Types ──────────────────────────────────────────────────────

/** Primary agent modes — the user switches between these via Tab. */
export type PrimaryAgentType = "build" | "plan";

/** Subagent types — invoked via @mention. */
export type SubagentType =
  | "explore"
  | "code-review"
  | "security"
  | "general"
  | "scout";

/** All agent identifiers. */
export type AgentType = PrimaryAgentType | SubagentType;

// ─── Agent Configuration ─────────────────────────────────────────────

/** Mode the agent operates in. */
export type AgentMode = "primary" | "subagent" | "all";

/** Full agent definition. */
export type AgentDef = {
  id: AgentType;
  label: string;
  description: string;
  mode: AgentMode;
  /** Whether this agent is hidden from @mention autocomplete. */
  hidden?: boolean;
  /** Color for UI indicators. */
  color?: string;
  /** Maximum agentic steps before forcing a result. */
  maxSteps?: number;
  /** Permission ruleset governing this agent's tool access. */
  permissions: PermissionRuleset;
  /** System prompt / persona definition. */
  systemPrompt: string;
  /** Tool allowlist — subset of all tools this agent may call. */
  tools: string[];
};

// ─── Tool Constants ───────────────────────────────────────────────────

const READ_ONLY_TOOLS = ["read_file", "list_directory", "grep", "glob"];

const BUILD_TOOLS = [
  ...READ_ONLY_TOOLS,
  "write_file",
  "edit",
  "multi_edit",
  "create_directory",
  "rename",
  "delete",
  "bash_run",
  "bash_background",
  "bash_logs",
  "bash_list",
  "bash_kill",
  "suggest_command",
  "get_terminal_output",
  "open_preview",
  "run_subagent",
  "todo_write",
  "web_search",
  "web_fetch",
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "memory_add",
  "memory_search",
  "skill_list",
  "skill_view",
  "skill_manage",
  "cron_create",
  "cron_list",
  "cron_delete",
];

const SUBAGENT_TOOLS = [...READ_ONLY_TOOLS];

// ─── Agent Registry ───────────────────────────────────────────────────

/** Primary agents: Build (full access) and Plan (read-only). */
export const PRIMARY_AGENTS: Record<PrimaryAgentType, AgentDef> = {
  build: {
    id: "build",
    label: "Build",
    description:
      "Default agent for development work — full access to edit, run commands, and manage the project.",
    mode: "primary",
    color: "#10b981", // emerald-500
    maxSteps: 50,
    permissions: BUILD_PERMISSIONS,
    tools: BUILD_TOOLS,
    systemPrompt: `You are a Build agent with full access to the codebase.
Your goal is to help the user build, edit, and debug their project.
You can read and write files, run shell commands, search the web, and manage tasks.
Be thorough — ask clarifying questions when requirements are ambiguous.
Chain actions: use multiple tools in sequence to complete a task in one turn.
After making changes, verify they work.`,
  },

  plan: {
    id: "plan",
    label: "Plan",
    description:
      "Read-only analysis agent for exploring codebases, planning architecture, and reviewing code.",
    mode: "primary",
    color: "#8b5cf6", // violet-500
    maxSteps: 30,
    permissions: PLAN_PERMISSIONS,
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are a Plan agent — a read-only analysis tool.
Your purpose is to explore, understand, and plan. You CANNOT edit files.
Use grep, glob, list_directory, and read_file to explore the codebase.
Analyze architecture, trace data flow, identify patterns, and propose designs.
Be concise but thorough. Return structured findings with file paths and line numbers.
If the user asks you to make changes, explain what should be done but do NOT edit.`,
  },
};

/**
 * Subagents — invoked via @mention in the composer.
 * When the user types @explore, @review, @security, @general, or @scout,
 * the main agent spawns the appropriate subagent.
 */
export const SUBAGENTS: Record<SubagentType, AgentDef> = {
  explore: {
    id: "explore",
    label: "Explore",
    description:
      "Read-only codebase explorer. Locates files, traces references, summarizes architecture.",
    mode: "subagent",
    color: "#06b6d4", // cyan-500
    maxSteps: 12,
    permissions: SUBAGENT_PERMISSIONS,
    tools: SUBAGENT_TOOLS,
    systemPrompt: `You are an exploration subagent. Your job is to answer the spawn question by READING the codebase only — no edits, no commands. Use grep/glob/list_directory/read_file. Be terse. Return a concise summary suitable for the main agent to act on (file paths, key findings, line numbers). Stop as soon as you can answer.`,
  },

  "code-review": {
    id: "code-review",
    label: "Code Review",
    description:
      "Reviews changed code for correctness, architecture, performance, security.",
    mode: "subagent",
    color: "#f59e0b", // amber-500
    maxSteps: 12,
    permissions: SUBAGENT_PERMISSIONS,
    tools: SUBAGENT_TOOLS,
    systemPrompt: `You are a code-review subagent. Inspect the requested code and report only ACTIONABLE findings: correctness bugs, architecture violations, performance issues, security risks. Skip style/formatting. Format each finding as: "[MUST/SHOULD/NIT] file:line — issue → fix". If nothing is wrong, say "Looks good." Do NOT propose unrelated cleanups.`,
  },

  security: {
    id: "security",
    label: "Security Review",
    description:
      "Audits code/configuration for security risks (auth, injection, secrets, etc).",
    mode: "subagent",
    color: "#ef4444", // red-500
    maxSteps: 12,
    permissions: SUBAGENT_PERMISSIONS,
    tools: SUBAGENT_TOOLS,
    systemPrompt: `You are a security-review subagent. Scan the requested scope for: injection (SQL, shell, path), auth/authz bypass, secret leakage, missing validation at trust boundaries, unsafe deserialization, weak crypto. Report concrete findings with file:line and severity. Be conservative — false positives hurt more than missed nits. If nothing is wrong, say "No security issues found."`,
  },

  general: {
    id: "general",
    label: "General Research",
    description:
      "General-purpose worker for multi-step research questions that span many files.",
    mode: "subagent",
    color: "#6366f1", // indigo-500
    maxSteps: 15,
    permissions: SUBAGENT_PERMISSIONS,
    tools: SUBAGENT_TOOLS,
    systemPrompt: `You are a general-purpose research subagent. Answer the spawn question by reading the codebase. Don't speculate — verify. Return a tight summary with the evidence you used (paths, line numbers).`,
  },

  scout: {
    id: "scout",
    label: "Scout",
    description:
      "Read-only agent for external docs, dependency research, and web exploration.",
    mode: "subagent",
    color: "#14b8a6", // teal-500
    maxSteps: 12,
    permissions: SUBAGENT_PERMISSIONS,
    tools: [...SUBAGENT_TOOLS, "web_search", "web_fetch"],
    systemPrompt: `You are a scout subagent. Your job is to research external resources — documentation, package registries, API references, and best practices. Use web_search and web_fetch to find information. Return a tight summary with sources. Do NOT edit any files.`,
  },
};

// ─── Agent Config via JSON/Markdown ────────────────────────────────────

/**
 * User-defined custom agent configuration.
 * Supports both JSON config (in opencode.json style) and Markdown files
 * (in ~/.config/openagent/agents/ or .openagent/agents/).
 */
export type CustomAgentConfig = {
  id: string;
  label: string;
  description: string;
  mode: AgentMode;
  hidden?: boolean;
  color?: string;
  model?: string;
  maxSteps?: number;
  permissions?: PermissionRuleset;
  system?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────

/** All available agents (primary + subagents). */
export const ALL_AGENTS: Record<string, AgentDef> = {
  ...PRIMARY_AGENTS,
  ...SUBAGENTS,
};

/** Get an agent definition by ID. */
export function getAgent(id: string): AgentDef | undefined {
  return ALL_AGENTS[id];
}

/** Get agents that can be @mentioned (subagents + any primary with mode=all). */
export function getMentionableAgents(): AgentDef[] {
  return Object.values(SUBAGENTS).filter((a) => !a.hidden);
}

/** Parse a @mention from user input and return the agent name. */
export function parseMention(text: string): string | null {
  const match = text.match(/@([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

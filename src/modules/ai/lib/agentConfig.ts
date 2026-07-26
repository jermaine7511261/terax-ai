import type { AgentDef, AgentType } from "../agents/registry";
import { BUILD_PERMISSIONS, SUBAGENT_PERMISSIONS } from "./permissions";
import type { PermissionRuleset } from "./permissions";

export type UserAgentConfig = {
  id: string;
  name: string;
  description?: string;
  system?: string;
  model?: string;
  maxSteps?: number;
  permissions?: PermissionRuleset;
  tools?: string[];
  color?: string;
};

const READ_ONLY_TOOLS = ["read_file", "list_directory", "grep", "glob"];
const BUILD_TOOLS = [
  ...READ_ONLY_TOOLS,
  "write_file", "edit", "multi_edit", "create_directory",
  "rename", "delete", "bash_run", "bash_background", "bash_logs",
  "bash_list", "bash_kill", "suggest_command", "get_terminal_output",
  "open_preview", "run_subagent", "todo_write", "web_search", "web_fetch",
  "lsp_diagnostics", "lsp_definition", "lsp_references",
  "memory_add", "memory_search", "skill_list", "skill_view", "skill_manage",
  "cron_create", "cron_list", "cron_delete",
];

export function buildAgentFromConfig(
  cfg: UserAgentConfig,
  mode: "primary" | "subagent",
): AgentDef {
  return {
    id: cfg.id as AgentType,
    label: cfg.name,
    description: cfg.description ?? `Custom ${mode} agent`,
    mode,
    color: cfg.color ?? (mode === "primary" ? "#10b981" : "#6366f1"),
    maxSteps: cfg.maxSteps ?? (mode === "primary" ? 50 : 12),
    permissions: cfg.permissions ?? (mode === "primary" ? BUILD_PERMISSIONS : SUBAGENT_PERMISSIONS),
    tools: cfg.tools ?? (mode === "primary" ? BUILD_TOOLS : READ_ONLY_TOOLS),
    systemPrompt: cfg.system ?? `You are a custom ${mode} agent. Follow the user's instructions carefully.`,
  };
}

export function parseAgentJson(json: string): UserAgentConfig | null {
  try {
    return JSON.parse(json) as UserAgentConfig;
  } catch {
    return null;
  }
}

export function parseAgentMarkdown(md: string): UserAgentConfig | null {
  const body = md.trim();
  if (!body.startsWith("---")) return null;
  const end = body.indexOf("---", 3);
  if (end === -1) return null;
  const frontmatter = body.slice(3, end).trim();
  const instructions = body.slice(end + 3).trim();
  try {
    const meta = JSON.parse(frontmatter) as Partial<UserAgentConfig>;
    return {
      id: meta.id ?? `custom-${Date.now().toString(36)}`,
      name: meta.name ?? "Custom Agent",
      description: meta.description,
      system: meta.system ?? instructions,
      model: meta.model,
      maxSteps: meta.maxSteps,
      permissions: meta.permissions,
      tools: meta.tools,
      color: meta.color,
    };
  } catch {
    return null;
  }
}

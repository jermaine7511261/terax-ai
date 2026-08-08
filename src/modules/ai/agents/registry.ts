export type SubagentType =
  | "explore"
  | "code-review"
  | "security"
  | "general"
  | "code"
  | "executor";

export type SubagentDef = {
  id: SubagentType;
  label: string;
  description: string;
  /**
   * Whitelist of tools the subagent may call. Excludes `run_subagent` itself
   * to prevent recursion. The runner filters down the main toolset to this
   * list before constructing the inner Agent.
   */
  tools: string[];
  systemPrompt: string;
};

const READ_ONLY_TOOLS = ["read_file", "list_directory", "grep", "glob"];
/** Read-only web research tools (MUST 差距 1 修复): deep_search 的
 *  researcher/verifier 必须能 web_search + fetch_url，否则研究阶段实际离线。 */
const WEB_TOOLS = ["web_search", "fetch_url"];
const WRITE_TOOLS = [
  "write_file",
  "edit",
  "multi_edit",
  "create_directory",
  "delete_file",
  "rename_file",
  "git_stage",
  "git_commit",
];
const EXEC_TOOLS = [
  "bash_run",
  "bash_background",
  "bash_logs",
  "bash_list",
  "bash_kill",
  ...WRITE_TOOLS,
];

export const SUBAGENTS: Record<SubagentType, SubagentDef> = {
  explore: {
    id: "explore",
    label: "Explore",
    description:
      "Read-only codebase explorer. Locates files, traces references, summarizes architecture.",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are an exploration subagent. Your job is to answer the spawn question by READING the codebase only — no edits, no commands. Use grep/glob/list_directory/read_file. Be terse. Return a concise summary suitable for the main agent to act on (file paths, key findings, line numbers). Stop as soon as you can answer.`,
  },
  "code-review": {
    id: "code-review",
    label: "Code review",
    description:
      "Reviews changed code for correctness, architecture, performance, security.",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are a code-review subagent. Inspect the requested code and report only ACTIONABLE findings: correctness bugs, architecture violations, performance issues, security risks. Skip style/formatting. Format each finding as: "[MUST/SHOULD/NIT] file:line — issue → fix". If nothing is wrong, say "Looks good." Do NOT propose unrelated cleanups.`,
  },
  security: {
    id: "security",
    label: "Security review",
    description:
      "Audits code/configuration for security risks (auth, injection, secrets, etc).",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are a security-review subagent. Scan the requested scope for: injection (SQL, shell, path), auth/authz bypass, secret leakage, missing validation at trust boundaries, unsafe deserialization, weak crypto. Report concrete findings with file:line and severity. Be conservative — false positives hurt more than missed nits. If nothing is wrong, say "No security issues found."`,
  },
  general: {
    id: "general",
    label: "General research",
    description:
      "General-purpose worker for multi-step research questions that span many files (and the web for deep_search).",
    tools: [...READ_ONLY_TOOLS, ...WEB_TOOLS],
    systemPrompt: `You are a general-purpose research subagent. Answer the spawn question by reading the codebase; for deep_search you also have web_search + fetch_url to gather web evidence. Don't speculate — verify. Return a tight summary with the evidence you used (paths, line numbers, URLs).`,
  },
  code: {
    id: "code",
    label: "Code",
    description:
      "Writable code worker — can create/edit/delete files and stage/commit git changes.",
    tools: [...READ_ONLY_TOOLS, ...WRITE_TOOLS],
    systemPrompt: `You are a code subagent. Your job is to implement the requested change by editing the codebase. You may read files (read_file/list_directory/grep/glob) and modify them (write_file/edit/multi_edit/create_directory/delete_file/rename_file). Use git_stage/git_commit only when the main agent explicitly asked for it. Follow existing conventions; keep edits minimal and focused. Before editing a file, read it. Return a concise summary of what you changed and why, with file paths.`,
  },
  executor: {
    id: "executor",
    label: "Executor",
    description:
      "Runs shell commands and edits files — for building, testing, and fixing in a loop.",
    tools: [...READ_ONLY_TOOLS, ...EXEC_TOOLS],
    systemPrompt: `You are an executor subagent. Your job is to run commands and make code changes to accomplish the task. You have read_file/list_directory/grep/glob for inspection, bash_run/bash_background/bash_logs/bash_list/bash_kill for shell, and write/edit/delete/rename for file changes. Never run destructive commands (rm -rf, dd, mkfs, git push --force). Before editing a file, read it. Stop as soon as the task is done or you hit a blocker. Return a concise summary with commands run, files changed, and results.`,
  },
};

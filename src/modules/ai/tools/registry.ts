/**
 * Static registry of built-in tool ids + descriptions, kept in sync with
 * `buildTools`. Lives in its own module (no tool-implementation imports) so
 * the settings window can render the tool-allowlist picker without eagerly
 * pulling the AI tool stack (see eager-budget.test.ts). MCP tools are dynamic
 * and therefore excluded — skills scope built-ins.
 */
export const TOOL_REGISTRY: ReadonlyArray<{ id: string; description: string }> = [
  { id: "read_file", description: "读取文件内容" },
  { id: "list_directory", description: "列出目录条目" },
  { id: "write_file", description: "写入文件（需审批）" },
  { id: "create_directory", description: "创建目录（需审批）" },
  { id: "delete_file", description: "删除文件（需审批）" },
  { id: "rename_file", description: "重命名/移动文件（需审批）" },
  { id: "edit", description: "单处编辑（需审批）" },
  { id: "multi_edit", description: "批量编辑（需审批）" },
  { id: "apply_patch", description: "应用 unified diff（需审批）" },
  { id: "grep", description: "按模式搜索文件内容" },
  { id: "glob", description: "按 glob 模式查找文件" },
  { id: "fetch_url", description: "获取网页内容（只读，SSRF+域名白名单）" },
  { id: "web_search", description: "网页搜索（DuckDuckGo，免 key）" },
  { id: "deep_search", description: "多步深度调研（需审批）" },
  { id: "bash_run", description: "执行 shell 命令（需审批）" },
  { id: "bash_background", description: "后台进程（需审批）" },
  { id: "bash_logs", description: "读取后台进程日志" },
  { id: "bash_list", description: "列出后台进程" },
  { id: "bash_kill", description: "终止后台进程（需审批）" },
  { id: "suggest_command", description: "建议 shell 命令" },
  { id: "get_terminal_output", description: "读取终端输出" },
  { id: "terminal_execute", description: "在终端执行（需审批）" },
  { id: "terminal_type", description: "在终端输入（需审批）" },
  { id: "open_preview", description: "打开网页预览" },
  { id: "run_subagent", description: "派生子 agent（需审批）" },
  { id: "spawn_coding_agent", description: "派发编码 agent（需审批）" },
  { id: "send_to_agent", description: "向 agent 发送消息（需审批）" },
  { id: "read_agent_output", description: "读取 agent 输出" },
  { id: "run_external_agent", description: "委托外部 agent（需审批）" },
  { id: "git_status", description: "读取 git 状态" },
  { id: "git_diff", description: "查看 git diff" },
  { id: "git_stage", description: "暂存更改（需审批）" },
  { id: "git_commit", description: "提交（需审批）" },
  { id: "todo_write", description: "更新任务清单" },
  { id: "update_project_memory", description: "写入项目记忆" },
];

/**
 * Tool concurrency-safety metadata (R28 #5). Mirrors Flock's
 * `Tool::is_concurrency_safe()`: declares whether two parallel workers may
 * invoke the same tool simultaneously without corrupting shared state.
 *
 * The rule: read-only tools (no shared mutable state) are safe; anything that
 * writes files, runs shells, or mutates git/todos/approvals is not safe to run
 * in parallel inside `delegate_many` / graph fan-outs.
 *
 *   ✅ safe:   read_file, list_directory, grep, glob, git_status, git_diff,
 *              search_memories, list_project_memory, todo_write, web_search,
 *              fetch_url
 *   ⚠️ conditional-safe (mtime-CAS write path): write_file, edit, multi_edit
 *   ❌ unsafe: bash_run, bash_background, create_directory, delete_file,
 *              rename_file, git_stage, git_commit, run_subagent, delegate_many, …
 */

const CONCURRENCY_SAFE: ReadonlySet<string> = new Set([
  // fs reads
  "read_file",
  "read_spreadsheet",
  "list_directory",
  "grep",
  "glob",
  // git reads
  "git_status",
  "git_diff",
  "git_blame",
  "git_log",
  "git_checkpoint_list",
  // memory / todo reads + appends
  "search_memories",
  "list_project_memory",
  "todo_write",
  // network reads
  "web_search",
  "fetch_url",
  "deep_search",
  "web_fetch",
  // terminal reads
  "get_terminal_output",
]);

/**
 * Tools that are safe ONLY when their optimistic-concurrency CAS is armed
 * (write_file / edit / multi_edit carry the read mtime). Parallel workers on
 * disjoint files are fine; same-file races are caught by the mtime check.
 */
const CONDITIONAL_SAFE: ReadonlySet<string> = new Set([
  "write_file",
  "edit",
  "multi_edit",
  "apply_patch",
  "create_docx",
  "create_xlsx",
  "create_pptx",
  "create_pdf",
  "edit_docx",
  "edit_xlsx",
  "edit_pptx",
  "merge_pdf",
  "encrypt_pdf",
]);

/**
 * Concurrency safety of a tool name: 2 = fully safe, 1 = conditional-safe,
 * 0 = unsafe (never run in parallel).
 */
export function concurrencyRank(toolName: string): 0 | 1 | 2 {
  if (CONCURRENCY_SAFE.has(toolName)) return 2;
  if (CONDITIONAL_SAFE.has(toolName)) return 1;
  return 0;
}

/** Fully-safe (rank 2). */
export function isConcurrencySafe(toolName: string): boolean {
  return concurrencyRank(toolName) === 2;
}

/**
 * Whether a tool set may be fanned out in parallel. Read-only sets are always
 * safe; a set is also safe when every unsafe tool is gated behind per-worker
 * isolation (not yet implemented) — for now only fully/conditionally-safe
 * sets qualify, which is exactly the `delegate_many` read-only worker case.
 */
export function isParallelSafe(toolNames: readonly string[]): boolean {
  if (toolNames.length === 0) return true;
  return toolNames.every((t) => concurrencyRank(t) >= 1);
}

import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@/platform";
import type { Channel } from "@/platform";

export type ReadResult =
  | { kind: "text"; content: string; size: number; mtime?: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
  gitignored: boolean;
};

export type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

export type GrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

export type GrepResponse = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

export type GlobHit = { path: string; rel: string };
export type GlobResponse = { hits: GlobHit[]; truncated: boolean };

export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
  hasSubmodules: boolean;
};

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  statusLabel: string;
};

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  changedFiles: GitChangedFile[];
};

export type GitDiffResult = {
  diffText: string;
  truncated: boolean;
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  truncated: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type GitBranchEntry = {
  name: string;
  kind: "local" | "worktree";
  worktreePath: string | null;
  isHead: boolean;
  isDetached: boolean;
};

export type GitBranchListResult = {
  branches: GitBranchEntry[];
};

export type GitStashEntry = {
  index: string;
  label: string;
  branch: string;
  message: string;
};

export type GitConflict = {
  path: string;
  status: string;
};

export type GitConflictResult = {
  conflicts: GitConflict[];
};

export type GitSubmoduleStatus = {
  path: string;
  status: string;
  shortSha: string;
  describe: string;
};

export type GitSubmoduleStatusResult = {
  submodules: GitSubmoduleStatus[];
};

export type WebFetchContent = {
  url: string;
  content: string;
  contentType: string;
  statusCode: number;
  bytes: number;
  truncated: boolean;
  metadata: Record<string, string>;
};

export type WebFetchCommandResult = {
  ok: boolean;
  output: ({ kind: string } & Record<string, unknown>) | null;
  error: string | null;
};

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  position?: number;
};

export type WebSearchCommandResult = {
  ok: boolean;
  query: string;
  results: WebSearchHit[];
  truncated: boolean;
  degraded: boolean;
  error: string | null;
};

export type AiHarnessEvent =
  | { kind: "turnStart"; id: number }
  | { kind: "textDelta"; id: number; text: string }
  | { kind: "reasoningDelta"; id: number; text: string }
  | { kind: "toolCall"; id: number; index: number; toolId: string; name: string }
  | { kind: "toolCallDelta"; id: number; index: number; args: string }
  | {
      kind: "finish";
      id: number;
      finishReason: string | null;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
    }
  | { kind: "end"; id: number }
  | { kind: "error"; id: number; message: string };

export type AiHarnessSessionStatus = {
  id: number;
  phase: "idle" | "running" | "done" | "error";
  stepCount: number;
  messageCount: number;
  aborted: boolean;
};

export type AiMemoryEntry = {
  id: string;
  content: string;
  scope: "global" | "workspace" | "session";
  createdAt: number;
  source?: string | null;
};

export type AiMemoryRecallHit = {
  content: string;
  score: number;
  scope: string;
  createdAt: number;
};

export type DeepSearchPoll = {
  id: number;
  phase: string;
  query: string;
  progress: string;
  verified: number;
  totalCandidates: number;
  usageRatio: number;
  report: string | null;
};

export type ComputerActionParams = {
  kind: "capture" | "click" | "type" | "key" | "drag" | "scroll" | "set_value";
  x?: number | null;
  y?: number | null;
  text?: string | null;
  key?: string | null;
  scrollDx?: number | null;
  scrollDy?: number | null;
};

export type ComputerCaptureResult = {
  ok: boolean;
  imageDataUrl: string | null;
  width: number | null;
  height: number | null;
  scale: number | null;
  error: string | null;
};

export const native = {
  workspaceCurrentDir: () => invoke<string>("workspace_current_dir"),
  workspaceSetCurrent: (path: string) =>
    invoke<void>("workspace_set_current", { path }),
  workspaceAuthorize: (path: string) =>
    invoke<string>("workspace_authorize", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  readFile: (path: string) =>
    invoke<ReadResult>("fs_read_file", {
      path,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  writeFile: (
    path: string,
    content: string,
    opts: { expectedMtime?: number } = {},
  ) =>
    invoke<void>("fs_write_file", {
      path,
      content,
      source: "ai",
      workspace: currentWorkspaceEnv(),
      expectedMtime: opts.expectedMtime ?? null,
    }),
  createDocx: (path: string, lines: string[]) =>
    invoke<number>("fs_create_docx", {
      path,
      lines,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  createXlsx: (path: string, rows: string[][]) =>
    invoke<number>("fs_create_xlsx", {
      path,
      rows,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  createPptx: (path: string, slides: string[]) =>
    invoke<number>("fs_create_pptx", {
      path,
      slides,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  createPdf: (path: string, lines: string[]) =>
    invoke<number>("fs_create_pdf", {
      path,
      lines,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  editDocx: (path: string, replacements: string[][]) =>
    invoke<number>("fs_edit_docx", {
      path,
      replacements,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  editPptx: (path: string, replacements: string[][]) =>
    invoke<number>("fs_edit_pptx", {
      path,
      replacements,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  editXlsx: (
    path: string,
    cells: { sheet: number; cell: string; kind?: string; value: string }[],
  ) =>
    invoke<number>("fs_edit_xlsx", {
      path,
      cells,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  pdfMerge: (files: string[], output: string) =>
    invoke<number>("fs_pdf_merge", {
      files,
      output,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  pdfEncrypt: (
    input: string,
    output: string,
    userPassword?: string,
    ownerPassword?: string,
  ) =>
    invoke<number>("fs_pdf_encrypt", {
      input,
      output,
      user_password: userPassword ?? null,
      owner_password: ownerPassword ?? null,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  canonicalize: (path: string) =>
    invoke<string>("fs_canonicalize", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  createFile: (path: string) =>
    invoke<void>("fs_create_file", {
      path,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  createDir: (path: string) =>
    invoke<void>("fs_create_dir", {
      path,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  renameFile: (from: string, to: string) =>
    invoke<void>("fs_rename", {
      from,
      to,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  deleteFile: (path: string) =>
    invoke<void>("fs_delete", {
      path,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  // AI tooling never sees dot-prefixed entries regardless of the user's
  // explorer preference — keeps .git / .env / .ssh out of agent context.
  readDir: (path: string) =>
    invoke<DirEntry[]>("fs_read_dir", {
      path,
      source: "ai",
      showHidden: false,
      workspace: currentWorkspaceEnv(),
    }),
  grep: (params: {
    pattern: string;
    root: string;
    glob?: string[];
    caseInsensitive?: boolean;
    maxResults?: number;
  }) =>
    invoke<GrepResponse>("fs_grep", {
      pattern: params.pattern,
      root: params.root,
      glob: params.glob ?? null,
      caseInsensitive: params.caseInsensitive ?? null,
      maxResults: params.maxResults ?? null,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  glob: (params: { pattern: string; root: string; maxResults?: number }) =>
    invoke<GlobResponse>("fs_glob", {
      pattern: params.pattern,
      root: params.root,
      maxResults: params.maxResults ?? null,
      source: "ai",
      workspace: currentWorkspaceEnv(),
    }),
  runCommand: (command: string, cwd?: string | null, timeoutSecs?: number) =>
    invoke<CommandOutput>("shell_run_command", {
      command,
      cwd: cwd ?? null,
      timeoutSecs: timeoutSecs ?? null,
      workspace: currentWorkspaceEnv(),
    }),

  shellSessionOpen: (cwd?: string | null) =>
    invoke<number>("shell_session_open", {
      cwd: cwd ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellSessionRun: (
    id: number,
    command: string,
    cwd?: string | null,
    timeoutSecs?: number,
  ) =>
    invoke<{
      stdout: string;
      stderr: string;
      exit_code: number | null;
      timed_out: boolean;
      truncated: boolean;
      cwd_after: string;
    }>("shell_session_run", {
      id,
      command,
      cwd: cwd ?? null,
      timeoutSecs: timeoutSecs ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellSessionClose: (id: number) =>
    invoke<void>("shell_session_close", { id }),
  shellBgSpawn: (command: string, cwd?: string | null) =>
    invoke<number>("shell_bg_spawn", {
      command,
      cwd: cwd ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  shellBgLogs: (handle: number, sinceOffset?: number) =>
    invoke<{
      bytes: string;
      next_offset: number;
      dropped: number;
      exited: boolean;
      exit_code: number | null;
    }>("shell_bg_logs", { handle, sinceOffset: sinceOffset ?? null }),
  shellBgKill: (handle: number) => invoke<void>("shell_bg_kill", { handle }),
  shellBgList: () =>
    invoke<
      {
        handle: number;
        command: string;
        cwd: string | null;
        started_at_ms: number;
        exited: boolean;
        exit_code: number | null;
      }[]
    >("shell_bg_list"),
  agentProbe: () =>
    invoke<
      {
        id: string;
        label: string;
        available: boolean;
        version: string | null;
        error: string | null;
      }[]
    >("agent_probe"),
  gitResolveRepo: (cwd: string) =>
    invoke<GitRepoInfo | null>("git_resolve_repo", {
      cwd,
      workspace: currentWorkspaceEnv(),
    }),
  gitPanelSnapshot: (cwd: string) =>
    invoke<GitPanelSnapshot>("git_panel_snapshot", {
      cwd,
      workspace: currentWorkspaceEnv(),
    }),
  gitStatus: (repoRoot: string) =>
    invoke<GitStatusSnapshot>("git_status", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitDiff: (repoRoot: string, path: string | null, staged: boolean) =>
    invoke<GitDiffResult>("git_diff", {
      repoRoot,
      path,
      staged,
      workspace: currentWorkspaceEnv(),
    }),
  gitDiffContent: (
    repoRoot: string,
    path: string,
    staged: boolean,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_diff_content", {
      repoRoot,
      path,
      staged,
      originalPath: originalPath ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitStage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_stage", {
      repoRoot,
      paths,
      workspace: currentWorkspaceEnv(),
    }),
  gitUnstage: (repoRoot: string, paths: string[]) =>
    invoke<void>("git_unstage", {
      repoRoot,
      paths,
      workspace: currentWorkspaceEnv(),
    }),
  gitDiscard: (repoRoot: string, entries: GitDiscardEntry[]) =>
    invoke<void>("git_discard", {
      repoRoot,
      entries,
      workspace: currentWorkspaceEnv(),
    }),
  gitCommit: (repoRoot: string, message: string) =>
    invoke<GitCommitResult>("git_commit", {
      repoRoot,
      message,
      workspace: currentWorkspaceEnv(),
    }),
  gitFetch: (repoRoot: string) =>
    invoke<void>("git_fetch", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitPullFfOnly: (repoRoot: string) =>
    invoke<void>("git_pull_ff_only", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitPush: (repoRoot: string) =>
    invoke<GitPushResult>("git_push", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitLog: (
    repoRoot: string,
    options?: { limit?: number; beforeSha?: string },
  ) =>
    invoke<GitLogEntry[]>("git_log", {
      repoRoot,
      limit: options?.limit ?? null,
      beforeSha: options?.beforeSha ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitShowCommit: (repoRoot: string, sha: string) =>
    invoke<GitDiffResult>("git_show_commit", {
      repoRoot,
      sha,
      workspace: currentWorkspaceEnv(),
    }),
  gitCommitFiles: (repoRoot: string, sha: string) =>
    invoke<GitCommitFileChange[]>("git_commit_files", {
      repoRoot,
      sha,
      workspace: currentWorkspaceEnv(),
    }),
  gitCommitFileDiff: (
    repoRoot: string,
    sha: string,
    path: string,
    originalPath?: string | null,
  ) =>
    invoke<GitDiffContentResult>("git_commit_file_diff", {
      repoRoot,
      sha,
      path,
      originalPath: originalPath ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitRemoteUrl: (repoRoot: string, name?: string) =>
    invoke<string | null>("git_remote_url", {
      repoRoot,
      name: name ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitListBranches: (repoRoot: string) =>
    invoke<GitBranchListResult>("git_list_branches", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitCheckoutBranch: (repoRoot: string, branch: string) =>
    invoke<void>("git_checkout_branch", {
      repoRoot,
      branch,
      workspace: currentWorkspaceEnv(),
    }),
  gitCreateBranch: (repoRoot: string, name: string) =>
    invoke<void>("git_create_branch", {
      repoRoot,
      name,
      workspace: currentWorkspaceEnv(),
    }),
  gitDeleteBranch: (repoRoot: string, name: string) =>
    invoke<void>("git_delete_branch", {
      repoRoot,
      name,
      workspace: currentWorkspaceEnv(),
    }),
  gitRenameBranch: (repoRoot: string, old: string, newName: string) =>
    invoke<void>("git_rename_branch", {
      repoRoot,
      old,
      new: newName,
      workspace: currentWorkspaceEnv(),
    }),
  gitPushUpstream: (repoRoot: string, remote?: string | null) =>
    invoke<GitPushResult>("git_push_upstream", {
      repoRoot,
      remote: remote ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitPull: (repoRoot: string, strategy?: "ff" | "rebase" | "merge" | null) =>
    invoke<void>("git_pull", {
      repoRoot,
      strategy: strategy ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashSave: (repoRoot: string, message?: string | null) =>
    invoke<void>("git_stash_save", {
      repoRoot,
      message: message ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashList: (repoRoot: string) =>
    invoke<GitStashEntry[]>("git_stash_list", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashPop: (repoRoot: string, index?: string | null) =>
    invoke<void>("git_stash_pop", {
      repoRoot,
      index: index ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashApply: (repoRoot: string, index?: string | null) =>
    invoke<void>("git_stash_apply", {
      repoRoot,
      index: index ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitStashDrop: (repoRoot: string, index?: string | null) =>
    invoke<void>("git_stash_drop", {
      repoRoot,
      index: index ?? null,
      workspace: currentWorkspaceEnv(),
    }),
  gitConflicts: (repoRoot: string) =>
    invoke<GitConflictResult>("git_conflicts", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitMergeAbort: (repoRoot: string) =>
    invoke<void>("git_merge_abort", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitCheckoutOurs: (repoRoot: string, path: string) =>
    invoke<void>("git_checkout_ours", {
      repoRoot,
      path,
      workspace: currentWorkspaceEnv(),
    }),
  gitCheckoutTheirs: (repoRoot: string, path: string) =>
    invoke<void>("git_checkout_theirs", {
      repoRoot,
      path,
      workspace: currentWorkspaceEnv(),
    }),
  gitSubmoduleStatus: (repoRoot: string) =>
    invoke<GitSubmoduleStatusResult>("git_submodule_status", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  gitSubmoduleUpdate: (repoRoot: string) =>
    invoke<void>("git_submodule_update", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
  webFetch: (url: string, maxChars?: number) =>
    invoke<WebFetchCommandResult>("web_fetch", {
      url,
      maxChars: maxChars ?? null,
    }),
  webSearch: (params: {
    query: string;
    maxResults?: number | null;
    categories?: string[] | null;
  }) =>
    invoke<WebSearchCommandResult>("web_search", {
      params: {
        query: params.query,
        maxResults: params.maxResults ?? null,
        categories: params.categories ?? null,
      },
    }),
  // --- 原生 AI harness (迭代 25, P0) ---
  aiSessionOpen: (params: {
    baseUrl: string;
    model: string;
    keyringAccount?: string | null;
    allowPrivateNetwork?: boolean;
    system?: string | null;
  }) =>
    invoke<number>("ai_session_open", {
      params: {
        baseUrl: params.baseUrl,
        model: params.model,
        keyringAccount: params.keyringAccount ?? null,
        allowPrivateNetwork: params.allowPrivateNetwork ?? false,
        system: params.system ?? null,
      },
    }),
  aiSessionSend: (
    id: number,
    text: string,
    onEvent: Channel<AiHarnessEvent>,
  ) =>
    invoke<void>("ai_session_send", { id, text, onEvent }),
  aiSessionAbort: (id: number) => invoke<void>("ai_session_abort", { id }),
  aiSessionClose: (id: number) => invoke<void>("ai_session_close", { id }),
  aiSessionStatus: (id: number) =>
    invoke<AiHarnessSessionStatus>("ai_session_status", { id }),
  aiEstimateTokens: (text: string) =>
    invoke<number>("ai_estimate_tokens", { text }),
  aiEstimateMessages: (messages: unknown[]) =>
    invoke<{ text: number }>("ai_estimate_messages", { messages }),
  memoryRemember: (params: {
    content: string;
    scope: string;
    source?: string | null;
  }) =>
    invoke<AiMemoryEntry>("memory_remember", {
      content: params.content,
      scope: params.scope,
      source: params.source ?? null,
    }),
  memoryRecall: (params: {
    query: string;
    limit?: number | null;
    scope?: string | null;
  }) =>
    invoke<AiMemoryRecallHit[]>("memory_recall", {
      query: params.query,
      limit: params.limit ?? null,
      scope: params.scope ?? null,
    }),
  memoryStats: () =>
    invoke<{ total: number; byScope: Record<string, number> }>("memory_stats"),
  deepSearchStart: (params: {
    query: string;
    breadth?: number | null;
    budget?: number | null;
  }) =>
    invoke<number>("deep_search_start", {
      params: {
        query: params.query,
        breadth: params.breadth ?? null,
        budget: params.budget ?? null,
      },
    }),
  deepSearchPoll: (id: number) =>
    invoke<DeepSearchPoll>("deep_search_poll", { id }),
  deepSearchAbort: (id: number) => invoke<void>("deep_search_abort", { id }),
  deepSearchAdvance: (params: {
    id: number;
    candidates?: unknown[] | null;
    verified?: unknown[] | null;
    coverageNotes?: string[] | null;
  }) =>
    invoke<DeepSearchPoll>("deep_search_advance", {
      id: params.id,
      candidates: params.candidates ?? null,
      verified: params.verified ?? null,
      coverageNotes: params.coverageNotes ?? null,
    }),
  deepSearchReserve: (id: number, workers: number) =>
    invoke<number>("deep_search_reserve", { id, workers }),
  // --- computer use (P3, Windows M1-M2) ---
  computerSessionOpen: () => invoke<number>("computer_session_open"),
  computerSessionClose: (id: number) =>
    invoke<void>("computer_session_close", { id }),
  computerApprove: (id: number) => invoke<void>("computer_approve", { id }),
  computerRevoke: (id: number) => invoke<void>("computer_revoke", { id }),
  computerCapture: (id: number) =>
    invoke<ComputerCaptureResult>("computer_capture", { id }),
  computerAction: (id: number, action: ComputerActionParams) =>
    invoke<string>("computer_action", { id, action }),
};

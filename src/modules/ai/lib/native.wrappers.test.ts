import { describe, expect, it, vi } from "vitest";

// Mechanical coverage of the remaining `native` wrappers (fs / shell / git)
// that native.test.ts does not exercise yet. Each test asserts the exact IPC
// command name + arg shape, which also guards against accidental arg drift.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => "default",
}));

import { invoke } from "@tauri-apps/api/core";
import { native } from "./native";

const mockInvoke = vi.mocked(invoke);
const WS = "default";

function expectInvoke(cmd: string, args: Record<string, unknown>) {
  expect(mockInvoke).toHaveBeenCalledWith(cmd, args);
}

describe("native fs wrappers", () => {
  it("canonicalize / createFile / createDir / renameFile / deleteFile", async () => {
    mockInvoke.mockResolvedValue("/canon");
    await native.canonicalize("/a");
    expectInvoke("fs_canonicalize", { path: "/a", workspace: WS });

    mockInvoke.mockResolvedValue(undefined);
    await native.createFile("/a");
    expectInvoke("fs_create_file", { path: "/a", source: "ai", workspace: WS });
    await native.createDir("/a");
    expectInvoke("fs_create_dir", { path: "/a", source: "ai", workspace: WS });
    await native.renameFile("/a", "/b");
    expectInvoke("fs_rename", { from: "/a", to: "/b", source: "ai", workspace: WS });
    await native.deleteFile("/a");
    expectInvoke("fs_delete", { path: "/a", source: "ai", workspace: WS });
  });

  it("glob forwards maxResults or null", async () => {
    mockInvoke.mockResolvedValue({ hits: [], truncated: false });
    await native.glob({ pattern: "**/*.ts", root: "/r" });
    expectInvoke("fs_glob", {
      pattern: "**/*.ts",
      root: "/r",
      maxResults: null,
      source: "ai",
      workspace: WS,
    });
    await native.glob({ pattern: "**/*.ts", root: "/r", maxResults: 50 });
    expectInvoke("fs_glob", {
      pattern: "**/*.ts",
      root: "/r",
      maxResults: 50,
      source: "ai",
      workspace: WS,
    });
  });
});

describe("native shell wrappers", () => {
  it("shellSessionOpen defaults cwd to null", async () => {
    mockInvoke.mockResolvedValue(1);
    await native.shellSessionOpen();
    expectInvoke("shell_session_open", { cwd: null, workspace: WS });
    await native.shellSessionOpen("/cwd");
    expectInvoke("shell_session_open", { cwd: "/cwd", workspace: WS });
  });

  it("shellSessionRun forwards id/command and nulls optional args", async () => {
    mockInvoke.mockResolvedValue({
      stdout: "",
      stderr: "",
      exit_code: 0,
      timed_out: false,
      truncated: false,
      cwd_after: "/cwd",
    });
    await native.shellSessionRun(2, "echo hi", "/cwd", 10);
    expectInvoke("shell_session_run", {
      id: 2,
      command: "echo hi",
      cwd: "/cwd",
      timeoutSecs: 10,
      env: null,
      workspace: WS,
    });
    await native.shellSessionRun(2, "echo hi");
    expectInvoke("shell_session_run", {
      id: 2,
      command: "echo hi",
      cwd: null,
      timeoutSecs: null,
      env: null,
      workspace: WS,
    });
  });

  it("shellSessionClose / shellBgSpawn / shellBgList / agentProbe", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await native.shellSessionClose(5);
    expectInvoke("shell_session_close", { id: 5 });

    mockInvoke.mockResolvedValue(7);
    await native.shellBgSpawn("sleep 1", "/cwd");
    expectInvoke("shell_bg_spawn", { command: "sleep 1", cwd: "/cwd", workspace: WS });
    await native.shellBgSpawn("sleep 1");
    expectInvoke("shell_bg_spawn", { command: "sleep 1", cwd: null, workspace: WS });

    mockInvoke.mockResolvedValue([]);
    await native.shellBgList();
    expect(mockInvoke).toHaveBeenCalledWith("shell_bg_list");

    mockInvoke.mockResolvedValue([]);
    await native.agentProbe();
    expect(mockInvoke).toHaveBeenCalledWith("agent_probe");
  });
});

describe("native git wrappers", () => {
  it("resolveRepo / status / diff", async () => {
    mockInvoke.mockResolvedValue(null);
    await native.gitResolveRepo("/r");
    expectInvoke("git_resolve_repo", { cwd: "/r", workspace: WS });

    mockInvoke.mockResolvedValue({ repo: null, status: null });
    await native.gitStatus("/r");
    expectInvoke("git_status", { repoRoot: "/r", workspace: WS });

    mockInvoke.mockResolvedValue({ diffText: "", truncated: false });
    await native.gitDiff("/r", "/a", true);
    expectInvoke("git_diff", { repoRoot: "/r", path: "/a", staged: true, workspace: WS });
    await native.gitDiff("/r", null, false);
    expectInvoke("git_diff", { repoRoot: "/r", path: null, staged: false, workspace: WS });
  });

  it("stage / unstage / discard / fetch / push / pull-ff", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await native.gitStage("/r", ["a.ts"]);
    expectInvoke("git_stage", { repoRoot: "/r", paths: ["a.ts"], workspace: WS });
    await native.gitUnstage("/r", ["a.ts"]);
    expectInvoke("git_unstage", { repoRoot: "/r", paths: ["a.ts"], workspace: WS });
    await native.gitDiscard("/r", [{ path: "a.ts", untracked: true }]);
    expectInvoke("git_discard", {
      repoRoot: "/r",
      entries: [{ path: "a.ts", untracked: true }],
      workspace: WS,
    });
    await native.gitFetch("/r");
    expectInvoke("git_fetch", { repoRoot: "/r", workspace: WS });
    await native.gitPullFfOnly("/r");
    expectInvoke("git_pull_ff_only", { repoRoot: "/r", workspace: WS });
    await native.gitPush("/r");
    expectInvoke("git_push", { repoRoot: "/r", workspace: WS });
  });

  it("showCommit / commitFiles / commitFileDiff", async () => {
    mockInvoke.mockResolvedValue({ diffText: "", truncated: false });
    await native.gitShowCommit("/r", "abc123");
    expectInvoke("git_show_commit", { repoRoot: "/r", sha: "abc123", workspace: WS });

    mockInvoke.mockResolvedValue([]);
    await native.gitCommitFiles("/r", "abc123");
    expectInvoke("git_commit_files", { repoRoot: "/r", sha: "abc123", workspace: WS });

    mockInvoke.mockResolvedValue({
      originalContent: "",
      modifiedContent: "",
      isBinary: false,
      fallbackPatch: "",
      truncated: false,
    });
    await native.gitCommitFileDiff("/r", "abc123", "/a.ts");
    expectInvoke("git_commit_file_diff", {
      repoRoot: "/r",
      sha: "abc123",
      path: "/a.ts",
      originalPath: null,
      workspace: WS,
    });
  });

  it("branch operations", async () => {
    mockInvoke.mockResolvedValue({ branches: [] });
    await native.gitListBranches("/r");
    expectInvoke("git_list_branches", { repoRoot: "/r", workspace: WS });

    mockInvoke.mockResolvedValue(undefined);
    await native.gitCheckoutBranch("/r", "feat/x");
    expectInvoke("git_checkout_branch", { repoRoot: "/r", branch: "feat/x", workspace: WS });
    await native.gitCreateBranch("/r", "feat/x");
    expectInvoke("git_create_branch", { repoRoot: "/r", name: "feat/x", workspace: WS });
    await native.gitDeleteBranch("/r", "feat/x");
    expectInvoke("git_delete_branch", { repoRoot: "/r", name: "feat/x", workspace: WS });
    await native.gitRenameBranch("/r", "old", "new");
    expectInvoke("git_rename_branch", { repoRoot: "/r", old: "old", new: "new", workspace: WS });
  });

  it("stash / conflicts / merge / submodules", async () => {
    mockInvoke.mockResolvedValue([]);
    await native.gitStashList("/r");
    expectInvoke("git_stash_list", { repoRoot: "/r", workspace: WS });

    mockInvoke.mockResolvedValue(undefined);
    await native.gitStashApply("/r", "0");
    expectInvoke("git_stash_apply", { repoRoot: "/r", index: "0", workspace: WS });
    await native.gitStashDrop("/r");
    expectInvoke("git_stash_drop", { repoRoot: "/r", index: null, workspace: WS });

    mockInvoke.mockResolvedValue({ conflicts: [] });
    await native.gitConflicts("/r");
    expectInvoke("git_conflicts", { repoRoot: "/r", workspace: WS });
    await native.gitMergeAbort("/r");
    expectInvoke("git_merge_abort", { repoRoot: "/r", workspace: WS });
    await native.gitCheckoutOurs("/r", "/a.ts");
    expectInvoke("git_checkout_ours", { repoRoot: "/r", path: "/a.ts", workspace: WS });
    await native.gitCheckoutTheirs("/r", "/a.ts");
    expectInvoke("git_checkout_theirs", { repoRoot: "/r", path: "/a.ts", workspace: WS });

    mockInvoke.mockResolvedValue({ submodules: [] });
    await native.gitSubmoduleStatus("/r");
    expectInvoke("git_submodule_status", { repoRoot: "/r", workspace: WS });
    await native.gitSubmoduleUpdate("/r");
    expectInvoke("git_submodule_update", { repoRoot: "/r", workspace: WS });
  });
});

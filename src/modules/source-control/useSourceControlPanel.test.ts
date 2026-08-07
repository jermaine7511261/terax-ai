// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GitChangedFile,
  GitStatusSnapshot,
} from "@/modules/ai/lib/native";

// ---------------------------------------------------------------------------
// Module mocks — isolate the hook from Tauri/tauri invoke, AI config, stores,
// the diff cache and i18n so the panel logic is exercised deterministically.
//
// NOTE: keep the `summary` object stable (created once, outside the render
// callback). The hook's status-reconciling effect depends on `summary.status`;
// recreating it on every render would retrigger setState in a loop.
// ---------------------------------------------------------------------------

/** In-memory stand-in for the `native` object exposed by `@/modules/ai/lib/native`. */
const nativeMock = vi.hoisted(() => {
  const native: Record<string, ReturnType<typeof vi.fn>> = {};
  const GIT_METHODS = [
    "gitStage",
    "gitUnstage",
    "gitDiscard",
    "gitDiff",
    "gitCommit",
    "gitStashList",
    "gitSubmoduleStatus",
    "gitStashSave",
    "gitStashApply",
    "gitStashPop",
    "gitStashDrop",
    "gitPull",
    "gitPushUpstream",
    "gitMergeAbort",
    "gitCheckoutOurs",
    "gitCheckoutTheirs",
    "gitSubmoduleUpdate",
  ] as const;
  function setup() {
    for (const m of GIT_METHODS) {
      native[m] = vi.fn().mockResolvedValue(undefined);
    }
    native.gitStashList.mockResolvedValue([]);
    native.gitSubmoduleStatus.mockResolvedValue({ submodules: [] });
    native.gitDiff.mockResolvedValue({ diffText: "", truncated: false });
  }
  return { native, setup };
});

/** Controllable `useChatStore` (zustand-style selector/getState/setState). */
const chatStoreMock = vi.hoisted(() => {
  const state: Record<string, any> = {
    selectedModelId: "deepseek-v4-flash",
    agentMeta: { status: "idle" },
    apiKeys: { deepseek: "sk-test" },
  };
  const store: any = (selector?: (s: any) => unknown) =>
    selector ? selector(state) : state;
  store.getState = () => state;
  store.setState = (patch: any) => {
    Object.assign(state, typeof patch === "function" ? patch(state) : patch);
  };
  return { store, state };
});

/** Controllable `usePreferencesStore`. */
const prefsStoreMock = vi.hoisted(() => {
  const state: Record<string, any> = {
    llamaCppModelId: "",
    openaiCompatibleBaseURL: "",
    openaiCompatibleModelId: "",
    openrouterModelId: "",
  };
  const store: any = (selector?: (s: any) => unknown) =>
    selector ? selector(state) : state;
  store.getState = () => state;
  store.setState = (patch: any) => {
    Object.assign(state, typeof patch === "function" ? patch(state) : patch);
  };
  return { store, state };
});

vi.mock("@/modules/ai/lib/native", () => ({ native: nativeMock.native }));
vi.mock("@/modules/editor/lib/diffCache", () => ({
  invalidateDiff: vi.fn(),
  invalidateRepoDiffs: vi.fn(),
  workingDiffKey: (repoRoot: string, path: string, mode: string) =>
    `${repoRoot}|w|${mode}|${path}`,
}));
vi.mock("@/lib/i18n", () => ({ tStatic: (key: string) => key }));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: chatStoreMock.store,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: prefsStoreMock.store,
}));
vi.mock("@/modules/ai/config", () => ({
  resolveModel: (id: string) => ({ id, provider: "deepseek", label: id }),
  providerNeedsKey: () => true,
  modelSupportsTemperature: () => true,
}));

import { useSourceControlPanel } from "./useSourceControlPanel";
import type { SourceControlSummary } from "./useSourceControl";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function file(over: Partial<GitChangedFile> & { path: string }): GitChangedFile {
  return {
    originalPath: null,
    indexStatus: " ",
    worktreeStatus: " ",
    staged: false,
    unstaged: false,
    untracked: false,
    statusLabel: "Modified",
    ...over,
  };
}

function makeStatus(files: GitChangedFile[] = []): GitStatusSnapshot {
  return {
    repoRoot: "/repo",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: files,
  };
}

const REPO = {
  repoRoot: "/repo",
  branch: "main",
  upstream: "origin/main",
  isDetached: false,
  hasSubmodules: false,
};

function makeSummary(over: Record<string, any> = {}): SourceControlSummary {
  return {
    repo: REPO,
    status: makeStatus(),
    changedCount: 0,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    hasRepo: true,
    isLoading: false,
    localError: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    runRemoteAction: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

// The 4-file fixture: one fully-staged, one partially staged (both), one
// modified-unstaged, one untracked.
function fourFileStatus(): GitStatusSnapshot {
  return makeStatus([
    file({
      path: "a.ts",
      indexStatus: "M",
      worktreeStatus: "M",
      staged: true,
      unstaged: true,
      statusLabel: "Modified",
    }),
    file({
      path: "b.ts",
      indexStatus: "A",
      worktreeStatus: " ",
      staged: true,
      statusLabel: "Added",
    }),
    file({
      path: "c.ts",
      indexStatus: " ",
      worktreeStatus: "M",
      unstaged: true,
      statusLabel: "Modified",
    }),
    file({
      path: "d.ts",
      indexStatus: "?",
      worktreeStatus: "?",
      unstaged: true,
      untracked: true,
      statusLabel: "Untracked",
    }),
  ]);
}

beforeEach(() => {
  nativeMock.setup();
  chatStoreMock.store.setState({
    selectedModelId: "deepseek-v4-flash",
    agentMeta: { status: "idle" },
    apiKeys: { deepseek: "sk-test" },
  });
  prefsStoreMock.store.setState({
    llamaCppModelId: "",
    openaiCompatibleBaseURL: "",
    openaiCompatibleModelId: "",
    openrouterModelId: "",
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSourceControlPanel", () => {
  it("starts closed when the panel is not open", () => {
    const summary = makeSummary();
    const { result } = renderHook(() =>
      useSourceControlPanel(false, summary, null),
    );
    expect(result.current.panelState).toBe("closed");
  });

  it("enters ready when a repo + status are available", () => {
    const summary = makeSummary();
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    expect(result.current.panelState).toBe("ready");
    expect(result.current.repo?.repoRoot).toBe("/repo");
    expect(result.current.status?.branch).toBe("main");
  });

  it("enters loading while the first status is being fetched", () => {
    const summary = makeSummary({
      hasRepo: false,
      repo: null,
      status: null,
      isLoading: true,
    });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    expect(result.current.panelState).toBe("loading");
  });

  it("enters no-repo when no repository exists", () => {
    const summary = makeSummary({
      hasRepo: false,
      repo: null,
      status: null,
      isLoading: false,
    });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    expect(result.current.panelState).toBe("no-repo");
  });

  it("enters error and clears status on a local status error", () => {
    const summary = makeSummary({ localError: "boom", status: null });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    expect(result.current.panelState).toBe("error");
    expect(result.current.statusError).toBe("boom");
    expect(result.current.status).toBeNull();
  });

  it("derives staged, unstaged and file entries from changed files", () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );

    // staged: a.ts (+ both), b.ts (+ added)
    expect(result.current.stagedEntries.map((e) => e.key)).toEqual([
      "+:a.ts",
      "+:b.ts",
    ]);
    expect(result.current.stagedEntries[0].statusCode).toBe("M");
    expect(result.current.stagedEntries[1].statusCode).toBe("A");

    // unstaged: a.ts (- both), c.ts (- modified), d.ts (- untracked)
    expect(result.current.unstagedEntries.map((e) => e.key)).toEqual([
      "-:a.ts",
      "-:c.ts",
      "-:d.ts",
    ]);
    expect(result.current.unstagedEntries[2].statusCode).toBe("U");

    // flat file entries, one per path
    const files = result.current.fileEntries;
    expect(files).toHaveLength(4);
    expect(files[0]).toMatchObject({ path: "a.ts", checkState: "indeterminate" });
    expect(files[1]).toMatchObject({ path: "b.ts", checkState: "checked" });
    expect(files[2]).toMatchObject({ path: "c.ts", checkState: "unchecked" });
    expect(files[3]).toMatchObject({
      path: "d.ts",
      checkState: "unchecked",
      untracked: true,
    });

    expect(result.current.headerCheckState).toBe("indeterminate");
    expect(result.current.allClean).toBe(false);
    expect(result.current.hasUncommitted).toBe(true);
    expect(result.current.canGenerateCommitMessage).toBe(true);
    expect(result.current.generateCommitMessageHint).toBe(
      "Generate commit message",
    );
  });

  it("reports an all-clean empty panel", () => {
    const summary = makeSummary();
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    expect(result.current.allClean).toBe(true);
    expect(result.current.hasUncommitted).toBe(false);
    expect(result.current.headerCheckState).toBe("unchecked");
    expect(result.current.canPush).toBe(true);
  });

  it("selectEntry stages an entry's diff via onOpenDiff", async () => {
    const onOpenDiff = vi.fn();
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, onOpenDiff),
    );
    const entry = result.current.unstagedEntries[2]; // -:d.ts
    await act(async () => result.current.selectEntry(entry));
    expect(result.current.selected).toEqual({ path: "d.ts", mode: "-" });
    expect(onOpenDiff).toHaveBeenCalledWith({
      path: "d.ts",
      repoRoot: "/repo",
      mode: "-",
      originalPath: null,
    });
  });

  it("stageEntry calls gitStage, applies optimistic status, and reconciles", async () => {
    vi.useFakeTimers();
    try {
      const summary = makeSummary({ status: fourFileStatus() });
      const { result } = renderHook(() =>
        useSourceControlPanel(true, summary, null),
      );
      const entry = result.current.unstagedEntries[1]; // -:c.ts

      await act(async () => result.current.stageEntry(entry));

      expect(nativeMock.native.gitStage).toHaveBeenCalledWith("/repo", ["c.ts"]);
      expect(summary.applyStatus).toHaveBeenCalledTimes(1);
      expect(result.current.actionBusy).toBeNull();
      expect(result.current.actionError).toBeNull();

      // A successful mutation schedules a debounced reconcile refresh.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(summary.refresh).toHaveBeenCalledWith({ remote: "never" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("unstageEntry calls gitUnstage with optimistic status", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    const entry = result.current.stagedEntries[1]; // +:b.ts

    await act(async () => result.current.unstageEntry(entry));

    expect(nativeMock.native.gitUnstage).toHaveBeenCalledWith("/repo", ["b.ts"]);
    expect(summary.applyStatus).toHaveBeenCalledTimes(1);
    expect(result.current.actionError).toBeNull();
  });

  it("toggleStageFile unstages when already checked, else stages", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    const checked = result.current.fileEntries[1]; // b.ts "checked"
    const unchecked = result.current.fileEntries[3]; // d.ts "unchecked"

    await act(async () => result.current.toggleStageFile(checked));
    expect(nativeMock.native.gitUnstage).toHaveBeenCalledWith("/repo", ["b.ts"]);

    await act(async () => result.current.toggleStageFile(unchecked));
    expect(nativeMock.native.gitStage).toHaveBeenCalledWith("/repo", ["d.ts"]);
  });

  it("toggleAll stages everything when header is unchecked", async () => {
    const summary = makeSummary({
      status: makeStatus([
        file({ path: "d.ts", unstaged: true, untracked: true }),
      ]),
    });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    expect(result.current.headerCheckState).toBe("unchecked");
    await act(async () => result.current.toggleAll());
    expect(nativeMock.native.gitStage).toHaveBeenCalledWith("/repo", ["d.ts"]);
  });

  it("reports a mutation error and restores state via refresh", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    nativeMock.native.gitStage.mockRejectedValueOnce(
      new Error("failed to stage"),
    );
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    const entry = result.current.unstagedEntries[1];

    await act(async () => result.current.stageEntry(entry));

    expect(result.current.actionError).toBe("failed to stage");
    expect(result.current.actionBusy).toBeNull();
    expect(summary.refresh).toHaveBeenCalledWith({ remote: "never" });
  });

  it("discard flow requests and confirms a single-file discard", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    const entry = result.current.unstagedEntries[1]; // -:c.ts

    act(() => result.current.requestDiscardEntry(entry));
    expect(result.current.pendingDiscard).toEqual({
      scope: "single",
      count: 1,
      label: "c.ts",
    });

    await act(async () => result.current.confirmPendingDiscard());
    expect(result.current.pendingDiscard).toBeNull();
    expect(nativeMock.native.gitDiscard).toHaveBeenCalledWith("/repo", [
      { path: "c.ts", untracked: false },
    ]);
  });

  it("cancelPendingDiscard clears the pending discard", () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    act(() =>
      result.current.requestDiscardEntry(result.current.unstagedEntries[1]),
    );
    expect(result.current.pendingDiscard).not.toBeNull();
    act(() => result.current.cancelPendingDiscard());
    expect(result.current.pendingDiscard).toBeNull();
  });

  it("commits the staged message, clears it, and reports the short sha", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    nativeMock.native.gitCommit.mockResolvedValue({
      commitSha: "abc123def456",
      summary: "feat: test",
    });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    act(() => result.current.setCommitMessage("feat: test"));

    await act(async () => result.current.commit());

    expect(nativeMock.native.gitCommit).toHaveBeenCalledWith(
      "/repo",
      "feat: test",
    );
    expect(result.current.commitMessage).toBe("");
    expect(result.current.actionMessage).toBe("Committed abc123d feat: test");
    expect(summary.refresh).toHaveBeenCalledWith({ remote: "never" });
    expect(result.current.actionError).toBeNull();
  });

  it("surfaces commit errors without clearing the message", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    nativeMock.native.gitCommit.mockRejectedValueOnce(
      new Error("commit failed"),
    );
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    act(() => result.current.setCommitMessage("feat: test"));

    await act(async () => result.current.commit());

    expect(result.current.actionError).toBe("commit failed");
    expect(result.current.commitMessage).toBe("feat: test");
    expect(result.current.actionBusy).toBeNull();
  });

  it("push reports success against the configured upstream", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    summary.runRemoteAction = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.push());
    expect(summary.runRemoteAction).toHaveBeenCalledWith("push");
    expect(result.current.actionMessage).toBe("Pushed to origin/main");
    expect(result.current.pendingPublish).toBe(false);
    expect(result.current.actionError).toBeNull();
  });

  it("push flags a missing upstream for publish", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    summary.runRemoteAction = vi
      .fn()
      .mockResolvedValue({ ok: false, blocked: "missing-upstream" });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.push());
    expect(result.current.pendingPublish).toBe(true);
  });

  it("push surfaces remote errors", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    summary.runRemoteAction = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "remote boom" });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.push());
    expect(result.current.actionError).toBe("remote boom");
  });

  it("publishes the current branch to its upstream", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.publishBranch());
    expect(nativeMock.native.gitPushUpstream).toHaveBeenCalledWith("/repo");
    expect(result.current.actionMessage).toBe("git.branchPublished");
    expect(summary.refresh).toHaveBeenCalledWith({ remote: "never" });
  });

  it("drives pushHint from upstream / ahead / behind", () => {
    const synced = makeSummary();
    const { result: syncedRes } = renderHook(() =>
      useSourceControlPanel(true, synced, null),
    );
    expect(syncedRes.current.pushHint).toContain("No local commits");

    const behind = makeSummary({ status: { ...makeStatus(), behind: 2 } });
    const { result: behindRes } = renderHook(() =>
      useSourceControlPanel(true, behind, null),
    );
    expect(behindRes.current.pushHint).toContain("Pull remote changes");

    const ahead = makeSummary({ status: { ...makeStatus(), ahead: 3 } });
    const { result: aheadRes } = renderHook(() =>
      useSourceControlPanel(true, ahead, null),
    );
    expect(aheadRes.current.pushHint).toBe("Pushes to origin/main.");

    const noUpstream = makeSummary({ status: { ...makeStatus(), upstream: null } });
    const { result: noUpRes } = renderHook(() =>
      useSourceControlPanel(true, noUpstream, null),
    );
    expect(noUpRes.current.pushHint).toContain("publish this branch");
  });

  it("moves the selection to the other group when a file switches staging side", async () => {
    let summary = makeSummary({
      status: makeStatus([
        file({ path: "a.ts", unstaged: true, statusLabel: "Modified" }),
      ]),
    });
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useSourceControlPanel(open, summary, null),
      { initialProps: { open: true } },
    );

    await act(async () =>
      result.current.selectEntry(result.current.unstagedEntries[0]),
    );
    expect(result.current.selected).toEqual({ path: "a.ts", mode: "-" });

    // The file is now only staged, so the "-" selection no longer exists but
    // the "+" mode does -> selection moves groups.
    summary = makeSummary({
      status: makeStatus([
        file({ path: "a.ts", staged: true, indexStatus: "M", statusLabel: "Modified" }),
      ]),
    });
    rerender({ open: true });

    expect(result.current.selected).toEqual({ path: "a.ts", mode: "+" });
    expect(result.current.selectionTransition).toBe("moved-group");
  });

  it("resets the selection when the selected file disappears", async () => {
    let summary = makeSummary({
      status: makeStatus([
        file({ path: "a.ts", unstaged: true, statusLabel: "Modified" }),
      ]),
    });
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useSourceControlPanel(open, summary, null),
      { initialProps: { open: true } },
    );

    await act(async () =>
      result.current.selectEntry(result.current.unstagedEntries[0]),
    );
    expect(result.current.selected).toEqual({ path: "a.ts", mode: "-" });

    summary = makeSummary({ status: makeStatus([]) });
    rerender({ open: true });

    expect(result.current.selected).toBeNull();
    expect(result.current.selectionTransition).toBe("reset");
  });

  it("blocks commit-message generation while an AI agent is busy", async () => {
    chatStoreMock.store.setState({
      agentMeta: { status: "streaming" },
    });
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.generateCommitMessage());
    expect(result.current.actionError).toBe(
      "Wait for the current AI action to finish",
    );
  });

  it("no-ops commit-message generation when nothing is staged", async () => {
    const summary = makeSummary({ status: makeStatus([]) });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.generateCommitMessage());
    expect(result.current.actionBusy).toBeNull();
    expect(result.current.actionError).toBeNull();
  });

  it("loads stashes from native and clears them on error", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    nativeMock.native.gitStashList.mockResolvedValue([
      { index: "0", label: "stash@{0}", branch: "main", message: "wip" },
    ]);
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.loadStashes());
    expect(result.current.stashes).toHaveLength(1);
    expect(result.current.stashes[0].message).toBe("wip");

    nativeMock.native.gitStashList.mockRejectedValueOnce(new Error("nope"));
    await act(async () => result.current.loadStashes());
    expect(result.current.stashes).toEqual([]);
  });

  it("stashSave persists a message and reloads stashes", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.stashSave("wip work"));
    expect(nativeMock.native.gitStashSave).toHaveBeenCalledWith(
      "/repo",
      "wip work",
    );
    expect(nativeMock.native.gitStashList).toHaveBeenCalledWith("/repo");
    expect(result.current.actionMessage).toBe("git.stashSaved");
  });

  it("pullWithStrategy pulls with the requested strategy", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.pullWithStrategy("rebase"));
    expect(nativeMock.native.gitPull).toHaveBeenCalledWith("/repo", "rebase");
    expect(result.current.actionMessage).toBe("git.pullCompleted");
  });

  it("abortMerge and conflict resolution call the right native methods", async () => {
    const summary = makeSummary({ status: fourFileStatus() });
    const { result } = renderHook(() =>
      useSourceControlPanel(true, summary, null),
    );
    await act(async () => result.current.abortMerge());
    expect(nativeMock.native.gitMergeAbort).toHaveBeenCalledWith("/repo");

    await act(async () => result.current.checkoutOurs("conflict.ts"));
    expect(nativeMock.native.gitCheckoutOurs).toHaveBeenCalledWith(
      "/repo",
      "conflict.ts",
    );

    await act(async () => result.current.checkoutTheirs("conflict.ts"));
    expect(nativeMock.native.gitCheckoutTheirs).toHaveBeenCalledWith(
      "/repo",
      "conflict.ts",
    );
  });
});

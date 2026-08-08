// @vitest-environment jsdom
// useSourceControl hook 主体的状态机测试（doRefresh / refresh / runRemoteAction）。
// 覆盖：可复用 repo root 快路径、自动 fetch 节流、无上下文、远程动作 fetch/pull/push、
// 以及 blocked（no-repo / missing-upstream / diverged）分支。
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  gitStatus: vi.fn(),
  gitPanelSnapshot: vi.fn(),
  gitFetch: vi.fn(),
  gitPullFfOnly: vi.fn(),
  gitPush: vi.fn(),
}));

vi.mock("@/modules/ai/lib/native", () => ({ native: nativeMock }));
vi.mock("@/modules/workspace", () => ({
  useWorkspaceEnvStore: () => ({}),
  workspaceScopeKey: () => "test",
}));

import { useSourceControl } from "./useSourceControl";
import type { GitRepoInfo, GitStatusSnapshot } from "@/modules/ai/lib/native";

const repo: GitRepoInfo = {
  repoRoot: "/repo",
  branch: "main",
  upstream: "origin/main",
  isDetached: false,
  hasSubmodules: false,
};

function status(over: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    repoRoot: "/repo",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMock.gitStatus.mockResolvedValue(status());
  nativeMock.gitPanelSnapshot.mockResolvedValue({ repo, status: status() });
  nativeMock.gitFetch.mockResolvedValue(undefined);
  nativeMock.gitPullFfOnly.mockResolvedValue(undefined);
  nativeMock.gitPush.mockResolvedValue(undefined);
});

describe("useSourceControl — refresh state machine", () => {
  it("loads a repo via gitPanelSnapshot when no reusable root exists", async () => {
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    expect(nativeMock.gitPanelSnapshot).toHaveBeenCalledWith("/repo");
    expect(result.current.repo?.repoRoot).toBe("/repo");
    expect(result.current.status?.branch).toBe("main");
  });

  it("reuses the active repo root for a subsequent refresh (fast path)", async () => {
    // Load /repo once; a later refresh for a path inside the same repo reuses
    // the active root → gitStatus, not a fresh gitPanelSnapshot.
    const { result } = renderHook(() => useSourceControl("/repo/src", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    expect(nativeMock.gitPanelSnapshot).toHaveBeenCalledTimes(1);

    nativeMock.gitStatus.mockClear();
    nativeMock.gitPanelSnapshot.mockClear();
    nativeMock.gitStatus.mockResolvedValue(status());
    await act(async () => {
      await result.current.refresh({ remote: "never" });
    });
    // Fast path: gitStatus used, gitPanelSnapshot NOT re-called.
    expect(nativeMock.gitStatus).toHaveBeenCalledWith("/repo");
    expect(nativeMock.gitPanelSnapshot).not.toHaveBeenCalled();
  });

  it("clears state when disabled", async () => {
    const { result } = renderHook(() => useSourceControl("/repo", false));
    await waitFor(() => expect(result.current.hasRepo).toBe(false));
    expect(result.current.repo).toBeNull();
    expect(nativeMock.gitPanelSnapshot).not.toHaveBeenCalled();
  });

  it("auto-fetches when remoteMode is always and upstream exists", async () => {
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    nativeMock.gitFetch.mockClear();
    nativeMock.gitStatus.mockClear();
    await act(async () => {
      await result.current.refresh({ remote: "always" });
    });
    expect(nativeMock.gitFetch).toHaveBeenCalledWith("/repo");
    expect(nativeMock.gitStatus).toHaveBeenCalled();
  });

  it("captures a remote error without failing the whole refresh", async () => {
    nativeMock.gitFetch.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    await act(async () => {
      await result.current.refresh({ remote: "always" });
    });
    expect(result.current.lastRemoteError).toBe("network down");
    expect(result.current.hasRepo).toBe(true);
  });

  it("normalizes non-Error rejections to a readable string", async () => {
    nativeMock.gitPanelSnapshot.mockRejectedValueOnce({ message: "boom" });
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.localError).toBe("boom"));
  });
});

describe("useSourceControl — runRemoteAction", () => {
  it("blocks with no-repo when nothing is loaded", async () => {
    const { result } = renderHook(() => useSourceControl(null, true));
    const res = await act(async () => result.current.runRemoteAction());
    expect(res).toMatchObject({ ok: false, blocked: "no-repo" });
  });

  it("blocks with missing-upstream when the branch has no upstream", async () => {
    nativeMock.gitPanelSnapshot.mockResolvedValue({
      repo: { ...repo, upstream: null },
      status: status({ upstream: null }),
    });
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    const res = await act(async () => result.current.runRemoteAction());
    expect(res).toMatchObject({ ok: false, blocked: "missing-upstream" });
  });

  it("runs a pull for a contextual action", async () => {
    nativeMock.gitPanelSnapshot.mockResolvedValue({
      repo,
      status: status({ ahead: 0, behind: 2 }),
    });
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    const res = await act(async () => result.current.runRemoteAction());
    expect(res).toMatchObject({ ok: true, action: "pull" });
    expect(nativeMock.gitPullFfOnly).toHaveBeenCalledWith("/repo");
  });

  it("runs a push for an explicit push action", async () => {
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    const res = await act(async () => result.current.runRemoteAction("push"));
    expect(res).toMatchObject({ ok: true, action: "push" });
    expect(nativeMock.gitPush).toHaveBeenCalledWith("/repo");
  });

  it("surfaces an error from a failed remote action", async () => {
    nativeMock.gitPush.mockRejectedValueOnce(new Error("permission denied"));
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    const res = await act(async () => result.current.runRemoteAction("push"));
    expect(res).toMatchObject({ ok: false, action: "push", error: "permission denied" });
  });

  it("blocks with diverged when contextual and both ahead & behind", async () => {
    nativeMock.gitPanelSnapshot.mockResolvedValue({
      repo,
      status: status({ ahead: 2, behind: 3 }),
    });
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    const res = await act(async () => result.current.runRemoteAction());
    expect(res).toMatchObject({ ok: false, action: null, blocked: "diverged" });
  });

  it("falls back to gitPanelSnapshot when the reusable-root fast path throws", async () => {
    // First load establishes /repo; then make gitStatus (fast path) throw so
    // doRefresh falls back to a full snapshot.
    const { result } = renderHook(() => useSourceControl("/repo/src", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    nativeMock.gitStatus.mockRejectedValueOnce(new Error("stale"));
    nativeMock.gitPanelSnapshot.mockClear();
    nativeMock.gitPanelSnapshot.mockResolvedValue({
      repo: { ...repo, repoRoot: "/repo" },
      status: status(),
    });
    await act(async () => {
      await result.current.refresh({ remote: "never" });
    });
    // The throw → catch → gitPanelSnapshot fallback keeps the repo loaded.
    expect(nativeMock.gitPanelSnapshot).toHaveBeenCalled();
    expect(result.current.hasRepo).toBe(true);
  });
});

describe("useSourceControl — inflight coalescing", () => {
  it("dedupes concurrent refreshes and reuses the inflight promise", async () => {
    let resolveStatus: (() => void) | undefined;
    nativeMock.gitPanelSnapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = () =>
            resolve({ repo, status: status() });
        }),
    );
    const { result } = renderHook(() => useSourceControl("/repo", true));
    // Kick two refreshes while the first is still in flight.
    const p1 = result.current.refresh({ remote: "never" });
    const p2 = result.current.refresh({ remote: "never" });
    // Only one gitPanelSnapshot should be issued for coalesced refreshes.
    expect(nativeMock.gitPanelSnapshot).toHaveBeenCalledTimes(1);
    act(() => resolveStatus?.());
    await Promise.all([p1, p2]);
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
  });
});

describe("useSourceControl — applyStatus & edge branches", () => {
  it("applyStatus is a no-op when there is no loaded status", async () => {
    const { result } = renderHook(() => useSourceControl(null, true));
    let applied = false;
    await act(async () => {
      result.current.applyStatus((s) => {
        applied = true;
        return s;
      });
    });
    expect(applied).toBe(false);
  });

  it("applyStatus updates the status and returns early when unchanged", async () => {
    const { result } = renderHook(() => useSourceControl("/repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(true));
    const original = result.current.status;
    await act(async () => {
      result.current.applyStatus((s) => s); // returns same → no change
    });
    expect(result.current.status).toBe(original);
  });

  it("clears repo state when the snapshot has no repo", async () => {
    nativeMock.gitPanelSnapshot.mockResolvedValue({ repo: null, status: null });
    const { result } = renderHook(() => useSourceControl("/not-a-repo", true));
    await waitFor(() => expect(result.current.hasRepo).toBe(false));
    expect(result.current.repo).toBeNull();
    expect(result.current.status).toBeNull();
  });
});

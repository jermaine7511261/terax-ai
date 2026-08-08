// biome-ignore-all lint/suspicious/noExplicitAny: 测试替身（summary 结构）需要宽松类型
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import { useSourceControlContext } from "./useSourceControlContext";

type Params = Parameters<typeof useSourceControlContext>[0];

const useSourceControlMock = vi.hoisted(() => vi.fn());
const gitResolveRepoMock = vi.hoisted(() => vi.fn());

vi.mock("./useSourceControl", () => ({
  useSourceControl: useSourceControlMock,
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: { gitResolveRepo: gitResolveRepoMock },
}));

let summary: any = {};
function setSummary(over: Record<string, unknown>) {
  summary = {
    repo: null,
    status: null,
    hasRepo: false,
    isLoading: false,
    localError: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: vi.fn(),
    refresh: vi.fn(),
    runRemoteAction: vi.fn(),
    ...over,
  };
}

function baseParams(over: Partial<Params> = {}): Params {
  return {
    activeTab: undefined,
    tabs: [],
    activeTerminalLeafCwd: null,
    explorerRoot: null,
    launchCwd: null,
    launchCwdResolved: false,
    home: null,
    sidebarView: "explorer",
    cycleSidebarView: vi.fn(),
    openCommitHistoryTab: vi.fn(),
    ...over,
  };
}

const editorTab = (path: string): Tab => ({
  id: 1,
  kind: "editor",
  spaceId: "default",
  title: "x",
  path,
  dirty: false,
  preview: false,
});

beforeEach(() => {
  setSummary({});
  useSourceControlMock.mockImplementation(() => summary);
  gitResolveRepoMock.mockReset();
});

describe("useSourceControlContext", () => {
  it("resolves the context path from an active editor tab's dirname", () => {
    renderHook(() =>
      useSourceControlContext(
        baseParams({ activeTab: editorTab("/proj/src/a.ts"), sidebarView: "source-control" }),
      ),
    );
    expect(useSourceControlMock).toHaveBeenCalledWith("/proj/src", true);
  });

  it("prefers terminal cwd over explorer root for an active terminal", () => {
    renderHook(() =>
      useSourceControlContext(
        baseParams({
          activeTab: { kind: "terminal", id: 1, title: "t", paneTree: { kind: "leaf", id: 2 }, activeLeafId: 2, spaceId: "default" },
          activeTerminalLeafCwd: "/term/cwd",
          explorerRoot: "/exp",
          sidebarView: "source-control",
        }),
      ),
    );
    expect(useSourceControlMock).toHaveBeenCalledWith("/term/cwd", true);
  });

  it("falls back to explorer root for a terminal without a cwd", () => {
    renderHook(() =>
      useSourceControlContext(
        baseParams({
          activeTab: { kind: "terminal", id: 1, title: "t", paneTree: { kind: "leaf", id: 2 }, activeLeafId: 2, spaceId: "default" },
          activeTerminalLeafCwd: null,
          explorerRoot: "/exp",
        }),
      ),
    );
    expect(useSourceControlMock).toHaveBeenCalledWith("/exp", true);
  });

  it("uses the git repo root for git-related tabs", () => {
    const gitTab: Tab = {
      id: 1,
      kind: "git-diff",
      spaceId: "default",
      title: "d",
      repoRoot: "/repo",
      path: "/repo/a.ts",
      mode: "+",
      originalPath: null,
      preview: false,
    };
    renderHook(() =>
      useSourceControlContext(baseParams({ activeTab: gitTab, sidebarView: "source-control" })),
    );
    expect(useSourceControlMock).toHaveBeenCalledWith("/repo", true);
  });

  it("activates source control when any git tab is open", () => {
    const gitTab: Tab = {
      id: 1,
      kind: "git-history",
      spaceId: "default",
      title: "h",
      repoRoot: "/repo",
      path: "/repo",
    } as Tab;
    renderHook(() =>
      useSourceControlContext(
        baseParams({ tabs: [gitTab], activeTab: undefined, explorerRoot: "/explorer" }),
      ),
    );
    // hasOpenGitTab → sourceControlActive → uses the (fallback) context path,
    // not the badge path.
    expect(useSourceControlMock).toHaveBeenCalledWith("/explorer", true);
  });

  it("uses the workspace fallback path when nothing else is available", () => {
    renderHook(() =>
      useSourceControlContext(
        baseParams({
          activeTab: undefined,
          explorerRoot: null,
          launchCwd: "/launch",
          launchCwdResolved: true,
        }),
      ),
    );
    expect(useSourceControlMock).toHaveBeenCalledWith("/launch", true);
  });

  it("toggleSourceControl cycles the sidebar to source-control", () => {
    const cycleSidebarView = vi.fn();
    const { result } = renderHook(() =>
      useSourceControlContext(baseParams({ cycleSidebarView })),
    );
    act(() => result.current.toggleSourceControl());
    expect(cycleSidebarView).toHaveBeenCalledWith("source-control");
  });

  it("openGitGraphFromContext opens history for a known repo", async () => {
    setSummary({ hasRepo: true, repo: { repoRoot: "/repo" }, status: { branch: "main" } });
    const openCommitHistoryTab = vi.fn();
    const { result } = renderHook(() =>
      useSourceControlContext(baseParams({ openCommitHistoryTab })),
    );
    await act(async () => result.current.openGitGraphFromContext());
    expect(openCommitHistoryTab).toHaveBeenCalledWith({
      repoRoot: "/repo",
      branch: "main",
    });
  });

  it("openGitGraphFromContext resolves via native when no repo is known", async () => {
    setSummary({ hasRepo: false });
    gitResolveRepoMock.mockResolvedValue({ repoRoot: "/found", branch: "dev" });
    const openCommitHistoryTab = vi.fn();
    const { result } = renderHook(() =>
      useSourceControlContext(
        baseParams({
          activeTab: editorTab("/proj/src/a.ts"),
          openCommitHistoryTab,
        }),
      ),
    );
    await act(async () => result.current.openGitGraphFromContext());
    expect(gitResolveRepoMock).toHaveBeenCalledWith("/proj/src");
    expect(openCommitHistoryTab).toHaveBeenCalledWith({
      repoRoot: "/found",
      branch: "dev",
    });
  });

  it("openGitGraphFromContext no-ops when native resolve returns nothing", async () => {
    setSummary({ hasRepo: false });
    gitResolveRepoMock.mockResolvedValue(null);
    const openCommitHistoryTab = vi.fn();
    const { result } = renderHook(() =>
      useSourceControlContext(
        baseParams({ activeTab: editorTab("/proj/src/a.ts"), openCommitHistoryTab }),
      ),
    );
    await act(async () => result.current.openGitGraphFromContext());
    expect(openCommitHistoryTab).not.toHaveBeenCalled();
  });
});

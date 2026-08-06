import { describe, expect, it } from "vitest";
import { useGitStatusBar } from "./useGitStatusBar";
import type { SourceControlSummary } from "@/modules/source-control";

function summary(over: Partial<SourceControlSummary>): SourceControlSummary {
  return {
    repo: null,
    status: null,
    changedCount: 0,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasRepo: false,
    isLoading: false,
    localError: null,
    busyAction: null,
    lastRemoteError: null,
    applyStatus: () => {},
    refresh: async () => {},
    runRemoteAction: async () => ({ ok: true, action: "fetch" }),
    ...over,
  };
}

describe("useGitStatusBar (pure derivation)", () => {
  it("reports no repo when the summary has none", () => {
    const s = useGitStatusBar(summary({ hasRepo: false }));
    expect(s).toMatchObject({ hasRepo: false, branch: null, isDetached: false, ahead: 0, behind: 0 });
  });

  it("prefers the status snapshot for branch/detached/ahead/behind", () => {
    const s = useGitStatusBar(
      summary({
        hasRepo: true,
        status: {
          repoRoot: "/r",
          branch: "main",
          upstream: "origin/main",
          ahead: 2,
          behind: 1,
          isDetached: false,
          truncated: false,
          changedFiles: [],
        },
        repo: { repoRoot: "/r", branch: "old", upstream: null, isDetached: true, hasSubmodules: false },
      }),
    );
    expect(s).toEqual({
      hasRepo: true,
      branch: "main",
      isDetached: false,
      ahead: 2,
      behind: 1,
    });
  });

  it("falls back to repo info when there is no status snapshot", () => {
    const s = useGitStatusBar(
      summary({
        hasRepo: true,
        status: null,
        repo: { repoRoot: "/r", branch: "dev", upstream: "origin/dev", isDetached: true, hasSubmodules: false },
      }),
    );
    expect(s).toEqual({ hasRepo: true, branch: "dev", isDetached: true, ahead: 0, behind: 0 });
  });

  it("defaults to zeros and false when both are absent", () => {
    const s = useGitStatusBar(summary({ hasRepo: true, status: null, repo: null }));
    expect(s).toEqual({ hasRepo: true, branch: null, isDetached: false, ahead: 0, behind: 0 });
  });
});

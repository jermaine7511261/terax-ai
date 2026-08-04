import type { SourceControlSummary } from "@/modules/source-control";

export type GitStatusBarState = {
  hasRepo: boolean;
  branch: string | null;
  isDetached: boolean;
  ahead: number;
  behind: number;
};

/**
 * Derives the branch pill display state from the source-control summary that
 * App already maintains. It reads the latest snapshot (status.repo) rather
 * than running any git command itself, so the status bar stays cheap and the
 * refresh cadence is the same one source-control uses.
 */
export function useGitStatusBar(
  summary: SourceControlSummary,
): GitStatusBarState {
  const status = summary.status;
  return {
    hasRepo: summary.hasRepo,
    branch: status?.branch ?? summary.repo?.branch ?? null,
    isDetached: status?.isDetached ?? summary.repo?.isDetached ?? false,
    ahead: status?.ahead ?? 0,
    behind: status?.behind ?? 0,
  };
}

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { LspStatusPill } from "@/modules/lsp";
import type { SourceControlSummary } from "@/modules/source-control";
import type { WorkspaceEnv } from "@/modules/workspace";
import { GitBranchIcon, IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { useGitStatusBar } from "./useGitStatusBar";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  /** Opens the panel, or Settings > Models when no API key is loaded. */
  onOpenAi: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
  hasComposer: boolean;
  privateActive: boolean;
  /** Live git summary maintained by the source-control subsystem. */
  sourceControl: SourceControlSummary;
  /** Opens the Source Control sidebar panel. */
  onOpenSourceControl: () => void;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  onOpenAi,
  hasComposer,
  privateActive,
  sourceControl,
  onOpenSourceControl,
}: Props) {
  const { t } = useI18n();
  const panelOpen = useChatStore((s) => s.panelOpen);
  const git = useGitStatusBar(sourceControl);

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 pl-3 pr-4 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        {git.hasRepo && git.branch ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenSourceControl}
                title={t("statusbar.openSourceControl")}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground hover:bg-accent"
              >
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  size={11}
                  strokeWidth={2}
                  className={
                    git.isDetached
                      ? "text-amber-600 dark:text-amber-400"
                      : undefined
                  }
                />
                <span
                  className={
                    git.isDetached
                      ? "text-amber-600 dark:text-amber-400"
                      : undefined
                  }
                >
                  {git.branch}
                </span>
                {git.ahead > 0 || git.behind > 0 ? (
                  <span className="text-muted-foreground">
                    ↑{git.ahead} ↓{git.behind}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              <div>
                {t("statusbar.gitBranch")}: {git.branch}
                {git.isDetached ? ` (${t("statusbar.gitDetached")})` : ""}
              </div>
              {git.ahead > 0 || git.behind > 0 ? (
                <div>
                  {t("statusbar.gitAheadBehind", {
                    ahead: git.ahead,
                    behind: git.behind,
                  })}
                </div>
              ) : null}
              <div className="text-muted-foreground">
                {t("statusbar.openSourceControl")}
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <LspStatusPill filePath={filePath ?? null} />
        <DiagnosticsBadge filePath={filePath ?? null} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>{t("statusbar.private")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              {t("statusbar.privateTooltip")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AgentStatusPill onClick={onOpenMini} />
        {panelOpen && hasComposer ? (
          <AiStatusBarControls />
        ) : (
          <AiOpenButton onOpen={onOpenAi} />
        )}
      </div>
    </footer>
  );
}

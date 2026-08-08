import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  CheckmarkCircleIcon,
  GitBranchIcon,
  GitMergeIcon,
  type SquareIcon,
  UserIcon,
  WorkflowSquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NodeKind, NodeStatus } from "../graph/types";

import { useGraphStore } from "../graph/store";

const KIND_ICON: Record<NodeKind, typeof SquareIcon> = {
  agent: WorkflowSquareIcon,
  judge: GitBranchIcon,
  human: UserIcon,
  merge: GitMergeIcon,
};

const STATUS_STYLE: Record<NodeStatus, string> = {
  pending: "text-muted-foreground/50 border-border/50",
  running: "text-sky-600 border-sky-400/60 bg-sky-500/10",
  done: "text-emerald-600 border-emerald-500/50 bg-emerald-500/5",
  failed: "text-destructive border-destructive/50 bg-destructive/5",
  "waiting-human": "text-amber-600 border-amber-500/60 bg-amber-500/10",
  cancelled: "text-muted-foreground/40 border-border/50",
};

const KIND_LABEL: Record<NodeKind, string> = {
  agent: "agent",
  judge: "judge",
  human: "human",
  merge: "merge",
};

/**
 * Graph run visualization (P0-1): renders the active graph's nodes with status
 * color + progress, a running summary, and inline human-approval / cancel
 * controls. Mounted in the AI panel side strip.
 */
export function GraphRunPanel() {
  const { t } = useI18n();
  const runId = useGraphStore((s) => s.activeRunId);
  const run = useGraphStore((s) => (runId ? s.runs[runId] : undefined));
  const pendingHuman = useGraphStore((s) => s.pendingHuman);
  const resolveHuman = useGraphStore((s) => s.resolveHuman);
  const cancel = useGraphStore((s) => s.cancel);

  if (!run) return null;

  const defs = run.def?.nodes ?? [];
  const nodeStates = Object.values(run.nodes);
  const nodes = defs.map((defNode) => ({
    ...(nodeStates.find((s) => s.nodeId === defNode.id) ?? {
      nodeId: defNode.id,
      status: "pending" as NodeStatus,
    }),
    kind: defNode.kind,
    label: defNode.name ?? defNode.prompt ?? defNode.id,
  }));
  const done = nodes.filter(
    (n) =>
      n.status === "done" ||
      n.status === "failed" ||
      n.status === "cancelled",
  ).length;
  const pct = nodes.length > 0 ? Math.round((done / nodes.length) * 100) : 0;

  return (
    <div className="flex shrink-0 flex-col border-t-2 border-border/40 bg-muted/80 px-3 py-2">
      <div className="my-1 flex items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">
          {t("ai.graphRun")}
        </span>
        {run.status === "running" && <Spinner className="size-2.5" />}
        <span className="truncate text-[10px] text-muted-foreground">
          {run.name}
        </span>
        <Progress value={pct} className="h-1 w-16" />
        {run.status === "running" && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
            onClick={cancel}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            {t("common.cancel")}
          </Button>
        )}
      </div>

      <ScrollArea className="max-h-56">
        <ul className="flex flex-col gap-1 py-0.5">
          {nodes.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? WorkflowSquareIcon;
            return (
              <li
                key={n.nodeId}
                className={cn(
                  "flex items-start gap-2 rounded border px-2 py-1 text-[11px]",
                  STATUS_STYLE[n.status],
                )}
              >
                <span className="mt-[1px] inline-flex size-3.5 shrink-0 items-center justify-center">
                  {n.status === "running" ? (
                    <Spinner className="size-3" />
                  ) : n.status === "done" ? (
                    <HugeiconsIcon
                      icon={CheckmarkCircleIcon}
                      size={12}
                      strokeWidth={1.75}
                      className="text-emerald-500"
                    />
                  ) : (
                    <HugeiconsIcon icon={Icon} size={12} strokeWidth={1.75} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{n.label ?? n.nodeId}</span>
                    <span className="rounded bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[n.kind]}
                    </span>
                    {n.status === "waiting-human" && (
                      <span className="text-amber-600">{t("ai.awaitingApproval")}</span>
                    )}
                  </div>
                  {n.output && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground/80">
                      {n.output.length > 120 ? `${n.output.slice(0, 120)}…` : n.output}
                    </div>
                  )}
                  {n.error && (
                    <div className="mt-0.5 text-[10px] text-destructive">
                      {n.error}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      {pendingHuman && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
          <div className="line-clamp-2 text-[10px] text-amber-700">
            {pendingHuman.prompt}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                title={t("ai.approveOnce")}
                onClick={() => resolveHuman(pendingHuman.nodeId, "once")}
              >
                {t("ai.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                title={t("ai.approveAlways")}
                onClick={() => resolveHuman(pendingHuman.nodeId, "always")}
              >
                {t("ai.approveAlways")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => resolveHuman(pendingHuman.nodeId, "reject")}
              >
                {t("ai.deny")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

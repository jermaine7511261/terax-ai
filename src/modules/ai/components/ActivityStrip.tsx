import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  CheckmarkCircleIcon,
  CodeIcon,
  Search01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AgentActivity } from "../store/agentActivityStore";
import { useRecentActivities } from "../store/agentActivityStore";
import { useChatStore } from "../store/chatStore";

const ACTIVITY_COLORS: Record<
  AgentActivity["kind"],
  { icon: typeof CodeIcon; bg: string; text: string }
> = {
  subagent: {
    icon: Search01Icon,
    bg: "bg-sky-500/10",
    text: "text-sky-600",
  },
  coding: {
    icon: CodeIcon,
    bg: "bg-emerald-500/10",
    text: "text-emerald-600",
  },
  external: {
    icon: Settings02Icon,
    bg: "bg-violet-500/10",
    text: "text-violet-600",
  },
  graph: {
    icon: CodeIcon,
    bg: "bg-amber-500/10",
    text: "text-amber-600",
  },
};

export function ActivityStrip() {
  const activities = useRecentActivities();
  const meta = useChatStore((s) => s.agentMeta);
  if (activities.length === 0 || activities.every((a) => a.status === "done"))
    return null;

  const running = activities.filter((a) => a.status === "running").length;
  const done = activities.filter((a) => a.status === "done").length;
  const pct =
    activities.length > 0
      ? Math.round(((done + activities.filter((a) => a.status === "error").length) / activities.length) * 100)
      : 0;

  return (
    <div className="flex shrink-0 flex-col border-t border-border/40 bg-muted/40 px-3 py-1.5">
      <div className="my-1 flex items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">
          {"Activity"}
        </span>
        {running > 0 && <Spinner className="size-2.5" />}
        {meta.phase && running > 0 && (
          <span className="rounded bg-muted px-1 py-0 text-[9px] uppercase tracking-wide text-muted-foreground">
            {meta.phase}
          </span>
        )}
        {meta.stepCount > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {meta.stepCount}
          </span>
        )}
        {meta.doomLoopDetected && (
          <span className="rounded bg-destructive/10 px-1 py-0 text-[9px] font-medium text-destructive">
            {"doom-loop"}
          </span>
        )}
        <Progress value={pct} className="h-1 flex-1" />
        <span className="text-[11px] tabular-nums font-mono text-muted-foreground">
          {done + activities.filter((a) => a.status === "error").length}/
          {activities.length}
        </span>
      </div>
      <ScrollArea className="max-h-32">
        <ul className="flex flex-col gap-0.5 py-0.5">
          {activities.slice(0, 8).map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function ActivityRow({ activity: a }: { activity: AgentActivity }) {
  const color = ACTIVITY_COLORS[a.kind] ?? ACTIVITY_COLORS.subagent;
  const isRunning = a.status === "running";
  const isError = a.status === "error";

  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded px-1.5 py-0.5 text-[11px] leading-snug transition-colors",
        isRunning && "bg-muted/40",
        isError && "bg-destructive/5",
      )}
    >
      <span className="mt-[2px] inline-flex size-3.5 shrink-0 items-center justify-center">
        {isRunning ? (
          <Spinner className="size-3" />
        ) : isError ? (
          <HugeiconsIcon
            icon={Cancel01Icon}
            size={12}
            strokeWidth={1.75}
            className="text-destructive"
          />
        ) : (
          <HugeiconsIcon
            icon={CheckmarkCircleIcon}
            size={12}
            strokeWidth={1.75}
            className="text-emerald-500"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium",
              color.bg,
              color.text,
            )}
          >
            <HugeiconsIcon
              icon={color.icon}
              size={10}
              strokeWidth={1.75}
              className="opacity-80"
            />
            {a.type}
          </span>
          {isRunning && a.step ? (
            <span className="truncate text-muted-foreground">{a.step}</span>
          ) : a.status === "done" && a.summary ? (
            <span className="truncate text-muted-foreground/80">
              {a.summary.length > 60
                ? `${a.summary.slice(0, 60)}…`
                : a.summary}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
          {a.prompt.length > 80 ? `${a.prompt.slice(0, 80)}…` : a.prompt}
        </div>
      </div>
      {a.durationMs != null && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
          {a.durationMs < 1000
            ? `${a.durationMs}ms`
            : `${(a.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </li>
  );
}

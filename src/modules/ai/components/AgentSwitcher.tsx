import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  ArrowDown01Icon,
  AbsoluteIcon,
  CodeIcon,
  PaintBrush04Icon,
  PencilEdit02Icon,
  Settings01Icon,
  ShieldUserIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { agentDisplayDescription, agentDisplayName, selectablePrimaryAgents, type AgentIconId } from "../lib/agents";
import { useAgentsStore } from "../store/agentsStore";

const ICONS: Record<AgentIconId, typeof CodeIcon> = {
  coder: CodeIcon,
  architect: AbsoluteIcon,
  reviewer: PencilEdit02Icon,
  security: ShieldUserIcon,
  designer: PaintBrush04Icon,
  spark: SparklesIcon,
};

export function AgentSwitcher() {
  const { t } = useI18n();
  const customAgents = useAgentsStore((s) => s.customAgents);
  const activeId = useAgentsStore((s) => s.activeId);
  const setActiveId = useAgentsStore((s) => s.setActiveId);

  const list = useAgentsStore.getState().all();
  void customAgents; // keeps the store subscription alive

  // P1-0: the primary picker only offers non-hidden, non-subagent-only agents
  // (opencode mode/hidden semantics). The active agent stays selectable even
  // if it's subagent-only, so the trigger always has a valid current value.
  const active = list.find((a) => a.id === activeId) ?? list[0];
  const visible = selectablePrimaryAgents(list);
  const builtIn = visible.filter((a) => a.builtIn);
  const custom = visible.filter((a) => !a.builtIn);
  const ActiveIcon = ICONS[active.icon] ?? SparklesIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          className="flex h-6 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
          title={agentDisplayName(active)}
        >
          <HugeiconsIcon icon={ActiveIcon} size={11} strokeWidth={1.75} />
          <span className="max-w-[5rem] truncate">{agentDisplayName(active)}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60 max-h-96 overflow-y-auto">
        <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {t("ai.agent")}
        </div>
        {builtIn.map((a) => {
          const Icon = ICONS[a.icon] ?? SparklesIcon;
          return (
            <DropdownMenuItem
              key={a.id}
              onSelect={() => setActiveId(a.id)}
              className={cn(
                "flex items-start gap-2 pr-2 text-[12px]",
                a.id === activeId && "bg-accent/40",
              )}
            >
              <HugeiconsIcon
                icon={Icon}
                size={13}
                strokeWidth={1.75}
                className={cn(
                  "mt-0.5",
                  a.id === activeId
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{agentDisplayName(a)}</span>
                <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                  {agentDisplayDescription(a)}
                </span>
              </span>
              {a.id === activeId ? (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={12}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-foreground"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}
        {custom.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 pt-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Custom
            </div>
            {custom.map((a) => {
              const Icon = ICONS[a.icon] ?? SparklesIcon;
              return (
                <DropdownMenuItem
                  key={a.id}
                  onSelect={() => setActiveId(a.id)}
                  className={cn(
                    "flex items-start gap-2 text-[12px]",
                    a.id === activeId && "bg-accent/40",
                  )}
                >
                  <HugeiconsIcon
                    icon={Icon}
                    size={13}
                    strokeWidth={1.75}
                    className="mt-0.5 text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{a.name}</span>
                    {a.description ? (
                      <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                        {a.description}
                      </span>
                    ) : null}
                  </span>
                  {a.id === activeId ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={12}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0 text-foreground"
                    />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void openSettingsWindow("agents")}
          className="gap-2 text-[12px] text-muted-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
          {t("ai.manageAgents")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ICONS as AGENT_ICONS };

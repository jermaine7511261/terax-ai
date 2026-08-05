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
import { useMemo, useState } from "react";
import {
  ArrowDown01Icon,
  AbsoluteIcon,
  CodeIcon,
  DeepseekIcon,
  GlobeIcon,
  MistralIcon,
  PaintBrush04Icon,
  PencilEdit02Icon,
  PlugIcon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  ShieldUserIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AgentIconId } from "../lib/agents";
import { useAgentsStore } from "../store/agentsStore";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  compatModelIdForEndpoint,
  getCompatModelInfo,
  getModel,
  isCompatModelId,
  MODELS,
  providerNeedsKey,
  type ModelId,
  type ProviderId,
} from "../config";

const ICONS: Record<AgentIconId, typeof CodeIcon> = {
  coder: CodeIcon,
  architect: AbsoluteIcon,
  reviewer: PencilEdit02Icon,
  security: ShieldUserIcon,
  designer: PaintBrush04Icon,
  spark: SparklesIcon,
};

const PROVIDER_ICON = {
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  "llama.cpp": ServerStack01Icon,
} as const satisfies Record<ProviderId, typeof DeepseekIcon>;

function ModelSection() {
  const { t } = useI18n();
  const selected = useChatStore((s) => s.selectedModelId);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setSelected = useChatStore((s) => s.setSelectedModelId);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const [search, setSearch] = useState("");

  const hasKeyFor = (id: ProviderId) =>
    providerNeedsKey(id) ? !!apiKeys[id] : true;

  const epModelInfos = useMemo(
    () =>
      customEndpoints.map((ep) =>
        getCompatModelInfo(compatModelIdForEndpoint(ep.id), customEndpoints),
      ),
    [customEndpoints],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool = [...MODELS, ...epModelInfos];
    // Default: hide models whose provider has no key configured.
    pool = pool.filter(
      (m) => isCompatModelId(m.id) || hasKeyFor(m.provider),
    );
    if (q) {
      pool = pool.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.hint.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      );
    }
    return pool;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, apiKeys, epModelInfos]);

  return (
    <>
      <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("ai.model")}
      </div>
      <div className="flex items-center gap-2 border-b border-border/60 px-2 pb-1.5">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground/70"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={t("ai.searchModels")}
          className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="px-2 py-4 text-center text-[11px] text-muted-foreground/70">
          {t("ai.noModelsMatch")}
        </div>
      ) : (
        filtered.map((m) => {
          const PIcon = PROVIDER_ICON[m.provider] ?? SparklesIcon;
          const hasKey = isCompatModelId(m.id) || hasKeyFor(m.provider);
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => {
                if (!isCompatModelId(m.id) && !hasKeyFor(m.provider)) {
                  void openSettingsWindow("models");
                  return;
                }
                setSelected(m.id);
              }}
              className={cn(
                "flex items-center gap-2 text-[12px]",
                m.id === selected && "bg-accent/40",
              )}
            >
              <HugeiconsIcon
                icon={PIcon}
                size={13}
                strokeWidth={1.75}
                className={cn(
                  "shrink-0",
                  m.id === selected
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{m.label}</span>
                <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                  {m.hint}
                </span>
              </span>
              {!hasKey && (
                <span className="shrink-0 text-[10px] text-amber-600">
                  {t("ai.noKeyConfiguredShort")}
                </span>
              )}
              {m.id === selected ? (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={12}
                  strokeWidth={2}
                  className="shrink-0 text-foreground"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })
      )}
    </>
  );
}

export function AgentSwitcher({ isMiniWindow }: { isMiniWindow?: boolean }) {
  const { t } = useI18n();
  const customAgents = useAgentsStore((s) => s.customAgents);
  const activeId = useAgentsStore((s) => s.activeId);
  const setActiveId = useAgentsStore((s) => s.setActiveId);
  const selectedModel = useChatStore((s) => s.selectedModelId);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);

  const list = useAgentsStore.getState().all();
  void customAgents; // keeps the store subscription alive

  const active = list.find((a) => a.id === activeId) ?? list[0];
  const builtIn = list.filter((a) => a.builtIn);
  const custom = list.filter((a) => !a.builtIn);
  const ActiveIcon = ICONS[active.icon] ?? SparklesIcon;

  const currentModel = isCompatModelId(selectedModel)
    ? getCompatModelInfo(selectedModel, customEndpoints)
    : getModel(selectedModel as ModelId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          className={cn(
            !isMiniWindow
              ? "flex h-6 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
              : "text-xs mr-1",
          )}
          title={`${active.name} · ${currentModel.label}`}
        >
          <HugeiconsIcon icon={ActiveIcon} size={11} strokeWidth={1.75} />
          <span className="max-w-[7rem] truncate">{active.name}</span>
          <span className="max-w-[5rem] truncate text-[10px] text-muted-foreground/70">
            · {currentModel.label}
          </span>
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
                <span>{a.name}</span>
                <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                  {a.description}
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
        <ModelSection />

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void openSettingsWindow("agents")}
          className="gap-2 text-[12px] text-muted-foreground"
        >
          <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
          Manage agents…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ICONS as AGENT_ICONS };

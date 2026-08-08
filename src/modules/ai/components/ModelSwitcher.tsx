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
import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown01Icon,
  DeepseekIcon,
  GlobeIcon,
  MistralIcon,
  PlugIcon,
  Search01Icon,
  ServerStack01Icon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setThinkingLength, type ThinkingLength } from "@/modules/settings/store";
import {
  compatModelIdForEndpoint,
  getCompatModelInfo,
  getModel,
  getModelContextLimit,
  isCompatModelId,
  MODELS,
  providerNeedsKey,
  type ModelId,
  type ProviderId,
} from "../config";

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

  const hasKeyFor = useCallback(
    (id: ProviderId) => (providerNeedsKey(id) ? !!apiKeys[id] : true),
    [apiKeys],
  );

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
  }, [search, epModelInfos, hasKeyFor]);

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

function ThinkingLengthSection() {
  const { t } = useI18n();
  const value = usePreferencesStore((s) => s.thinkingLength);

  const options: { id: ThinkingLength; label: string }[] = [
    { id: "off", label: t("ai.thinkingOff") },
    { id: "low", label: t("ai.thinkingLow") },
    { id: "medium", label: t("ai.thinkingMedium") },
    { id: "high", label: t("ai.thinkingHigh") },
  ];

  return (
    <>
      <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {t("ai.thinkingLength")}
      </div>
      {options.map((o) => (
        <DropdownMenuItem
          key={o.id}
          onSelect={() => void setThinkingLength(o.id)}
          className={cn(
            "flex items-center gap-2 text-[12px]",
            o.id === value && "bg-accent/40",
          )}
        >
          <span className="min-w-0 flex-1">{o.label}</span>
          {o.id === value ? (
            <HugeiconsIcon
              icon={Tick02Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 text-foreground"
            />
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function ModelSwitcher() {
  const { t } = useI18n();
  const selectedModel = useChatStore((s) => s.selectedModelId);
  const contextEstimate = useChatStore((s) => s.contextEstimate);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);

  const currentModel = isCompatModelId(selectedModel)
    ? getCompatModelInfo(selectedModel, customEndpoints)
    : getModel(selectedModel as ModelId);
  const PIcon = PROVIDER_ICON[currentModel.provider] ?? SparklesIcon;

  // Context usage percent, computed from the SAME approximation the compaction
  // logic uses (approxBytes/4) over the model's context limit. Mirrors Hermes's
  // status-bar `context_pct`: the number IS "how close to compaction".
  const contextLimit = getModelContextLimit(selectedModel, undefined);
  const contextPct =
    contextLimit > 0 ? Math.round((contextEstimate / contextLimit) * 100) : 0;
  const showPct = contextEstimate > 0 && contextLimit > 0;
  // Warn colors near the compaction thresholds (55% first prune / 70% elide).
  const pctTone = contextPct >= 70 ? "text-red-500" : contextPct >= 55 ? "text-amber-500" : "text-muted-foreground";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          className="flex h-6 items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
          title={`${currentModel.label} · ${showPct ? `${contextPct}% context used` : "context"}`}
        >
          <HugeiconsIcon icon={PIcon} size={11} strokeWidth={1.75} />
          <span className="max-w-[7rem] truncate">{currentModel.label}</span>
          {showPct && (
            <span className={`text-[9.5px] font-medium tabular-nums ${pctTone}`}>
              {contextPct}%
            </span>
          )}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60 max-h-96 overflow-y-auto">
        <ModelSection />
        <DropdownMenuSeparator />
        <ThinkingLengthSection />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void openSettingsWindow("models")}
          className="gap-2 text-[12px] text-muted-foreground"
        >
          <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={1.75} />
          {t("ai.manageModels")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

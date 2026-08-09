import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  estimateCost,
  getEffectiveContextLimit,
  getModel,
  type ModelId,
} from "../config";
import { useChatStore } from "../store/chatStore";

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Context usage pill for the status bar (sits right before the ModelSwitcher).
 * Shows the current/last request token usage against the effective context
 * window; hover reveals per-session breakdown (model, cache, cost).
 */
export function ContextUsagePill() {
  const { t } = useI18n();
  const modelId = useChatStore((s) => s.selectedModelId);
  const tokens = useChatStore((s) => s.agentMeta.tokens);
  const lastInput = useChatStore((s) => s.agentMeta.lastInputTokens);
  const lastCached = useChatStore((s) => s.agentMeta.lastCachedTokens);
  const toggleMini = useChatStore((s) => s.toggleMini);
  const openaiCompatibleContextLimit = usePreferencesStore(
    (s) => s.openaiCompatibleContextLimit,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);

  const max = getEffectiveContextLimit(
    modelId,
    customEndpoints,
    openaiCompatibleContextLimit,
  );
  const used = lastInput > 0 ? lastInput : tokens.inputTokens + tokens.outputTokens;
  const reported = tokens.inputTokens + tokens.outputTokens;
  const modelLabel = (() => {
    try {
      return getModel(modelId as ModelId).label;
    } catch {
      return modelId;
    }
  })();
  const cost = estimateCost(modelId, tokens);
  const cacheRate =
    tokens.inputTokens > 0
      ? Math.round((tokens.cachedInputTokens / tokens.inputTokens) * 100)
      : 0;

  // Nothing to show before any AI activity in the session.
  if (used <= 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggleMini}
          title={t("ai.openAiLog")}
          className="flex h-6 items-center gap-0.5 rounded-md border border-border/60 bg-card px-1.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <span>{formatTokens(used)}</span>
          <span className="opacity-50">/{formatTokens(max)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="w-60 text-[11px]">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>{t("common.model")}</span>
          <span className="font-mono text-foreground">{modelLabel}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-muted-foreground">
          <span>{lastInput > 0 ? t("ai.lastRequest") : t("ai.estimatedContext")}</span>
          <span className="font-mono text-foreground">{formatTokens(used)}</span>
        </div>
        {lastCached > 0 && (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t("ai.cachedPart")}</span>
            <span className="font-mono text-foreground">{formatTokens(lastCached)}</span>
          </div>
        )}
        {reported > 0 && (
          <>
            <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
              <span>{t("ai.sessionInput")}</span>
              <span className="font-mono text-foreground">{formatTokens(tokens.inputTokens)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{t("ai.sessionOutput")}</span>
              <span className="font-mono text-foreground">{formatTokens(tokens.outputTokens)}</span>
            </div>
            {tokens.cachedInputTokens > 0 && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t("ai.cacheHit")}</span>
                <span className="font-mono text-foreground">{cacheRate}%</span>
              </div>
            )}
            {cost != null && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t("ai.sessionCost")}</span>
                <span className="font-mono text-foreground">
                  ${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}
                </span>
              </div>
            )}
          </>
        )}
        <div className="flex items-center justify-between text-muted-foreground">
          <span>{t("common.window")}</span>
          <span className="font-mono text-foreground">{formatTokens(max)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { PROVIDERS } from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setProviderFallbackChain } from "@/modules/settings/store";
import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

type BreakerState = "closed" | "open" | "halfOpen";
type BreakerSnapshot = {
  id: string;
  state: BreakerState;
  failureCount: number;
  successCount: number;
  openedAt?: number | null;
};

const DOT_TONE: Record<BreakerState, string> = {
  closed: "bg-emerald-500",
  open: "bg-red-500",
  halfOpen: "bg-amber-500",
};

const STATE_LABEL: Record<BreakerState, string> = {
  closed: "Closed",
  open: "Open",
  halfOpen: "HalfOpen",
};

/**
 * Provider fallback chain (R29 §3.2.2): the ordered provider list the agent
 * tries when the primary is unavailable, plus a live circuit-breaker status
 * per provider from the Rust resilience layer.
 */
export function ProviderFallbackChain() {
  const { t } = useI18n();
  const chain = usePreferencesStore((s) => s.providerFallbackChain);
  const [breakers, setBreakers] = useState<Record<string, BreakerSnapshot>>({});

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await native.resilienceStatus();
        if (!alive) return;
        const map: Record<string, BreakerSnapshot> = {};
        for (const b of list) map[b.id] = b;
        setBreakers(map);
      } catch {
        if (alive) setBreakers({});
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Default chain = all providers in registry order (empty pref = default).
  const ordered =
    chain.length > 0
      ? chain
      : PROVIDERS.map((p) => p.id);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    void setProviderFallbackChain(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-foreground">
          {t("settingsModels.fallbackChain")}
        </span>
        {chain.length > 0 ? (
          <button
            type="button"
            onClick={() => void setProviderFallbackChain([])}
            className="text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("settingsModels.resetChain")}
          </button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1">
        {ordered.map((id, i) => {
          const provider = PROVIDERS.find((p) => p.id === id);
          const breaker = breakers[id];
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-2 py-1"
            >
              <span className="w-5 text-center font-mono text-[10px] text-muted-foreground/60">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
                {provider?.label ?? id}
              </span>
              {breaker ? (
                <span
                  className="inline-flex items-center gap-1 text-[9.5px] text-muted-foreground"
                  title={`failures ${breaker.failureCount} · successes ${breaker.successCount}`}
                >
                  <span
                    className={cn("size-1.5 rounded-full", DOT_TONE[breaker.state])}
                  />
                  {STATE_LABEL[breaker.state]}
                </span>
              ) : null}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={t("settingsModels.moveUp")}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} size={11} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === ordered.length - 1}
                  aria-label={t("settingsModels.moveDown")}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

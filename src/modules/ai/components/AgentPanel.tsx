import { useI18n, tStatic } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { native, type AgentDef, type AgentRunRecord } from "@/modules/ai/lib/native";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useState } from "react";

type RegistryEntry = { def: AgentDef; source: string };

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(usd: number): string {
  if (usd <= 0) return "—";
  return `$${usd.toFixed(usd < 0.01 ? 4 : usd < 1 ? 3 : 2)}`;
}

function ModeBadge({ mode }: { mode: AgentDef["mode"] }) {
  const tone =
    mode === "primary"
      ? "bg-primary/15 text-primary"
      : mode === "hidden"
        ? "bg-muted text-muted-foreground"
        : "bg-sky-500/10 text-sky-600";
  return (
    <span className={cn("rounded px-1 py-0 text-[9px] font-medium", tone)}>
      {mode}
    </span>
  );
}

function StateBadge({ state }: { state: AgentRunRecord["state"] }) {
  const label =
    state.kind === "idle"
      ? "idle"
      : state.kind === "failed"
        ? "failed"
        : state.kind;
  const tone =
    state.kind === "idle"
      ? "bg-emerald-500/10 text-emerald-600"
      : state.kind === "failed"
        ? "bg-destructive/10 text-destructive"
        : "bg-amber-500/10 text-amber-600";
  return (
    <span className={cn("rounded px-1 py-0 text-[9px] font-medium", tone)}>
      {label}
    </span>
  );
}

/**
 * Agent workspace panel (R28 #9): surfaces the agent platform engine —
 * the registry (definitions + sources), live run history with token/cost/
 * duration/state, and a per-agent budget note. The full file-sandbox +
 * terminal per agent is a follow-on; this panel is the observability surface.
 */
export function AgentPanel() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<RegistryEntry[] | null>(null);
  const [history, setHistory] = useState<AgentRunRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [reg, hist] = await Promise.all([
          native.agentRegistryList(),
          native.agentHistory(null),
        ]);
        if (!alive) return;
        setEntries(reg);
        setHistory(hist);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 px-3 py-2">
        <div className="text-[12px] font-semibold">{t("sidebar.agents")}</div>
        <div className="text-[10px] text-muted-foreground">
          {tStatic("agents.platformHint")}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error ? (
          <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        ) : !entries ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="size-4" />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            {tStatic("agents.emptyRegistry")}
          </div>
        ) : (
          <>
            <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {tStatic("agents.definitions")}
            </div>
            <ul className="flex flex-col gap-1">
              {entries.map(({ def, source }) => (
                <li
                  key={def.id}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5",
                    def.enabled ? "bg-card/60" : "opacity-50",
                  )}
                >
                  <span
                    className="mt-1 size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: def.color ?? "var(--muted-foreground)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-foreground">
                        {def.name}
                      </span>
                      <ModeBadge mode={def.mode} />
                      <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/60">
                        {source}
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {def.description || def.systemPrompt.slice(0, 60)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[9px] text-muted-foreground/70">
                      {def.model ? (
                        <span className="font-mono">{def.model}</span>
                      ) : null}
                      {def.maxSteps ? (
                        <span>≤{def.maxSteps} steps</span>
                      ) : null}
                      {def.budgetCap ? (
                        <span>${def.budgetCap} cap</span>
                      ) : null}
                      {def.planMode ? <span>plan</span> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mb-1 mt-3 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {tStatic("agents.runHistory")}
            </div>
            {history.length === 0 ? (
              <div className="px-1 py-3 text-[10.5px] text-muted-foreground/70">
                {tStatic("agents.noRuns")}
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {history.slice(0, 30).map((r) => (
                  <li
                    key={r.instanceId}
                    className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[10px]"
                  >
                    <StateBadge state={r.state} />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {r.defId}
                    </span>
                    <span className="shrink-0 text-muted-foreground/70">
                      {fmtTokens(r.tokenUsage.input + r.tokenUsage.output)} tok
                    </span>
                    <span className="shrink-0 text-muted-foreground/70">
                      {fmtDuration(r.durationMs)}
                    </span>
                    <span className="shrink-0 text-muted-foreground/70">
                      {fmtCost(r.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

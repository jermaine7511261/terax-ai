import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { useEffect } from "react";
import { useMcpStore, useMcpStatusBridge } from "../lib/store";
import { cn } from "@/lib/utils";

/**
 * Sidebar MCP view: lists configured MCP servers with their connection state
 * and lets the user connect/disconnect. Gives the AI tool-facing MCP servers a
 * first-class main-UI entry (previously only reachable via Settings → MCP).
 */
export function McpSidebarPanel({ root: _root }: { root: string | null }) {
  const { t } = useI18n();
  useMcpStatusBridge();
  const servers = useMcpStore((s) => s.servers);
  const loaded = useMcpStore((s) => s.loaded);
  const busy = useMcpStore((s) => s.busy);
  const refresh = useMcpStore((s) => s.refresh);
  const connect = useMcpStore((s) => s.connect);
  const disconnect = useMcpStore((s) => s.disconnect);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("settingsMcp.servers")}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          title={t("settingsMcp.refresh")}
        >
          <RefreshIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!loaded ? (
          <div className="flex items-center gap-1.5 px-1 py-1.5 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            {t("settingsMcp.checking")}
          </div>
        ) : servers.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("settingsMcp.empty")}</EmptyTitle>
              <EmptyDescription>{t("settingsMcp.sidebarHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          servers.map((s) => {
            const connected = s.status === "connected";
            const connecting = s.status === "connecting";
            const isBusy = busy[s.id] || connecting;
            const statusDot =
              s.status === "connected"
                ? "bg-emerald-500"
                : s.status === "error"
                  ? "bg-red-500"
                  : s.status === "connecting"
                    ? "bg-amber-400 animate-pulse"
                    : "bg-muted-foreground/40";
            return (
              <div
                key={s.id}
                className="mb-1 rounded-md border border-border/50 bg-card/50 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", statusDot)} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                    {s.name}
                  </span>
                  {connected ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void disconnect(s.id)}
                      disabled={isBusy}
                      className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      {t("settingsMcp.disconnect")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void connect(s.id)}
                      disabled={isBusy}
                      className="h-5 shrink-0 px-1.5 text-[10px]"
                    >
                      {isBusy ? (
                        <Spinner className="size-2.5" />
                      ) : (
                        t("settingsMcp.connect")
                      )}
                    </Button>
                  )}
                </div>
                <p className="mt-1 truncate text-[10px] text-muted-foreground/70">
                  {s.transport}
                  {connected
                    ? ` · ${s.tools.length} ${t("settingsMcp.tools")}${
                        s.resources.length > 0
                          ? ` · ${s.resources.length} ${t("settingsMcp.resources")}`
                          : ""
                      }`
                    : s.status === "error" && s.error
                      ? ` · ${s.error}`
                      : ""}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>Refresh</title>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

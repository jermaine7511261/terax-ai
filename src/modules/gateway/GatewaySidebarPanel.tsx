import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type PlatformStatus = {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
};

/**
 * Sidebar IM-gateway view: lists connected platforms with their state and
 * lets the user connect/disconnect. Gives the gateway (previously only in
 * Settings → IM 网关) a main-UI entry so the feature is discoverable.
 */
export function GatewaySidebarPanel() {
  const { t } = useI18n();
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    void invoke<PlatformStatus[]>("gateway_platforms").then(setPlatforms);
  };

  useEffect(() => {
    refresh();
  }, []);

  const connect = async (id: string) => {
    setBusyId(id);
    try {
      await invoke("gateway_connect", { platform: id });
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (id: string) => {
    setBusyId(id);
    try {
      await invoke("gateway_disconnect", { platform: id });
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t("gateway.title")}
        </span>
        <button
          type="button"
          onClick={refresh}
          className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          title={t("common.refresh")}
        >
          <RefreshIcon />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {platforms.length === 0 ? (
          <p className="px-1 py-1.5 text-[11px] text-muted-foreground">
            {t("gateway.noPlatforms")}
          </p>
        ) : (
          platforms.map((p) => {
            const isBusy = busyId === p.id;
            const statusDot = p.connected
              ? "size-1.5 shrink-0 rounded-full bg-emerald-500"
              : "size-1.5 shrink-0 rounded-full bg-muted-foreground/40";
            return (
              <div
                key={p.id}
                className="mb-1 flex items-center gap-1.5 rounded-md border border-border/50 bg-card/50 px-2 py-1.5"
              >
                <span className={statusDot} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                  {p.label}
                </span>
                {p.connected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void disconnect(p.id)}
                    disabled={isBusy}
                    className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {isBusy ? <Spinner className="size-2.5" /> : t("gateway.disconnect")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void connect(p.id)}
                    disabled={isBusy}
                    className="h-5 shrink-0 px-1.5 text-[10px]"
                  >
                    {isBusy ? <Spinner className="size-2.5" /> : t("gateway.connect")}
                  </Button>
                )}
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
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

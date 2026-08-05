import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useI18n } from "@/lib/i18n";

type QrFrame =
  | { kind: "qr"; svg_data_url: string }
  | { kind: "status"; status: string }
  | { kind: "confirmed"; account_id: string; token: string; base_url: string };

type FlowState = {
  running: boolean;
  qrUrl: string | null;
  statusLabel: string;
  error: string | null;
};

/**
 * Global overlay for WeChat re-login QR in the main window.
 * Listens for `yamet:gateway-platform-event` (weixin QR frames) and
 * shows a non-blocking QR overlay so the user can re-scan without
 * opening Settings.
 */
export function WeixinReloginOverlay() {
  const { t } = useI18n();
  const [flow, setFlow] = useState<FlowState>({
    running: false,
    qrUrl: null,
    statusLabel: "",
    error: null,
  });

  useEffect(() => {
    let un: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen<[string, unknown]>("yamet:gateway-platform-event", (e) => {
        const [platform, payload] = e.payload;
        if (platform !== "weixin") return;
        const frame = payload as QrFrame;
        if (frame.kind === "qr") {
          setFlow((s) => ({
            ...s,
            running: true,
            qrUrl: frame.svg_data_url,
            statusLabel: "waiting",
            error: null,
          }));
        } else if (frame.kind === "status") {
          setFlow((s) => ({
            ...s,
            statusLabel: frame.status === "scanned" ? "scanned" : "waiting",
          }));
        } else if (frame.kind === "confirmed") {
          void invoke("gateway_weixin_persist", {
            accountId: frame.account_id,
            token: frame.token,
            baseUrl: frame.base_url,
          }).catch(() => {});
          setFlow({ running: false, qrUrl: null, statusLabel: "done", error: null });
          // Auto-close after a brief delay.
          setTimeout(() => setFlow((s) => ({ ...s, statusLabel: "" })), 2000);
        }
      })
      .then((u) => { un = u; });
    return () => un?.();
  }, []);

  const dismiss = useCallback(() => {
    setFlow({ running: false, qrUrl: null, statusLabel: "", error: null });
  }, []);

  if (!flow.running && !flow.qrUrl && flow.statusLabel !== "done") return null;

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto rounded-xl border border-amber-500/40 bg-background/95 shadow-xl p-4 space-y-3 max-w-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-amber-600">
            {flow.statusLabel === "done"
              ? t("gateway.reloginDone")
              : t("gateway.reloginTitle")}
          </span>
          {flow.qrUrl && flow.statusLabel !== "done" && (
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
        {flow.qrUrl && flow.statusLabel !== "done" ? (
          <>
            <img
              src={flow.qrUrl}
              alt={t("gateway.relogin")}
              className="mx-auto size-48 rounded-lg border border-border/50 bg-white p-2"
            />
            <p className="text-xs text-muted-foreground text-center">
              {t("gateway.reloginHint")}
            </p>
            <p className="text-xs text-muted-foreground text-center">
              {flow.statusLabel === "scanned"
                ? t("gateway.qrScanned")
                : t("gateway.reloginWaiting")}
            </p>
          </>
        ) : (
          !flow.qrUrl && (
            <p className="text-xs text-muted-foreground text-center">
              {t("gateway.reloginWaiting")}
            </p>
          )
        )}
        {flow.error && (
          <p className="text-xs text-destructive text-center">
            {t("gateway.reloginError")}: {flow.error}
          </p>
        )}
      </div>
    </div>
  );
}

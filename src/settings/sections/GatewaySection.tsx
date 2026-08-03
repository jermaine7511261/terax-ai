import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { type JSX, useEffect, useState } from "react";

type QrFrame =
  | { kind: "qr"; svg_data_url: string }
  | { kind: "status"; status: string }
  | { kind: "confirmed"; account_id: string; token: string; base_url: string };

type QrFlow = {
  running: boolean;
  qrUrl: string | null;
  statusLabel: string;
  error: string | null;
};

type SessionInfo = {
  session_key: string;
  platform: string;
  chat_type: string;
  chat_id: string;
  authorized: boolean;
  auto_approve: boolean;
  awaiting_approval: boolean;
  last_active_ms: number;
};

type PlatformStatus = {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
};

type FieldDef = { key: string; labelKey: string; secret?: boolean };

/// Credential fields each platform accepts (keys match the Rust Config serde).
const FIELDS: Record<string, FieldDef[]> = {
  dingtalk: [
    { key: "app_key", labelKey: "appKey" },
    { key: "app_secret", labelKey: "appSecret", secret: true },
    { key: "robot_code", labelKey: "robotCode" },
  ],
  feishu: [
    { key: "app_id", labelKey: "appId" },
    { key: "app_secret", labelKey: "appSecret", secret: true },
  ],
  wecom: [
    { key: "corp_id", labelKey: "corpId" },
    { key: "corp_secret", labelKey: "corpSecret", secret: true },
    { key: "agent_id", labelKey: "agentId" },
    { key: "token", labelKey: "callbackToken" },
    { key: "encoding_aes_key", labelKey: "encodingAesKey", secret: true },
  ],
  qq: [
    { key: "ws_url", labelKey: "wsUrl" },
    { key: "access_token", labelKey: "accessToken", secret: true },
  ],
  weixin: [
    { key: "base_url", labelKey: "baseUrl" },
    { key: "token", labelKey: "token", secret: true },
    { key: "account_id", labelKey: "accountId" },
  ],
  official_account: [
    { key: "app_id", labelKey: "appId" },
    { key: "app_secret", labelKey: "appSecret", secret: true },
    { key: "token", labelKey: "callbackToken" },
    { key: "encoding_aes_key", labelKey: "encodingAesKey", secret: true },
  ],
};

export function GatewaySection(): JSX.Element {
  const { t } = useI18n();
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});

  const refresh = () => {
    void invoke<PlatformStatus[]>("gateway_platforms").then(setPlatforms);
  };
  useEffect(() => {
    refresh();
  }, []);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const refreshSessions = () => {
    void invoke<SessionInfo[]>("gateway_sessions").then(setSessions);
  };
  useEffect(() => {
    refreshSessions();
  }, []);
  useEffect(() => {
    let un: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen<string>("yamet:gateway-pending", () => refreshSessions())
      .then((u) => {
        un = u;
      });
    return () => {
      un?.();
    };
  }, []);

  const setField = (id: string, key: string, v: string) =>
    setValues((prev) => ({ ...prev, [id]: { ...prev[id], [key]: v } }));

  const save = async (id: string) => {
    await invoke("gateway_configure", {
      platform: id,
      configJson: JSON.stringify(values[id] ?? {}),
    });
    refresh();
  };
  const connect = (id: string) => {
    void invoke("gateway_connect", { platform: id }).then(refresh);
  };
  const disconnect = (id: string) => {
    void invoke("gateway_disconnect", { platform: id }).then(refresh);
  };
  const [testChatId, setTestChatId] = useState<Record<string, string>>({});
  const [testText, setTestText] = useState<Record<string, string>>({});
  const [testGroup, setTestGroup] = useState<Record<string, boolean>>({});
  const [qrFlow, setQrFlow] = useState<QrFlow>({
    running: false,
    qrUrl: null,
    statusLabel: "",
    error: null,
  });

  const startQrLogin = async (id: string) => {
    setQrFlow({ running: true, qrUrl: null, statusLabel: "waiting", error: null });
    const ch = new Channel<QrFrame>();
    ch.onmessage = (frame) => {
      if (frame.kind === "qr") {
        setQrFlow((s) => ({ ...s, qrUrl: frame.svg_data_url, statusLabel: "waiting" }));
      } else if (frame.kind === "status") {
        setQrFlow((s) => ({
          ...s,
          statusLabel: frame.status === "scanned" ? "scanned" : "waiting",
        }));
      } else if (frame.kind === "confirmed") {
        setQrFlow((s) => ({ ...s, running: false, statusLabel: "done" }));
        // Auto-fill the persisted credentials into the config fields.
        setValues((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            base_url: frame.base_url,
            token: frame.token,
            account_id: frame.account_id,
          },
        }));
      }
    };
    try {
      await invoke("gateway_weixin_qr_login", { onFrame: ch });
      refresh();
    } catch (e) {
      setQrFlow((s) => ({ ...s, running: false, error: String(e) }));
    }
  };
  const stopQrLogin = () =>
    setQrFlow((s) => ({ ...s, running: false, qrUrl: null }));
  const sendTest = (id: string) => {
    const chatId = (testChatId[id] ?? "").trim();
    const text = (testText[id] ?? "").trim();
    if (!chatId || !text) return;
    void invoke("gateway_send", {
      platform: id,
      chatId,
      text,
      group: testGroup[id] ?? false,
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("gateway.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("gateway.subtitle")}</p>
      {platforms.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("gateway.noPlatforms")}</p>
      )}
      {platforms.map((p) => (
        <div key={p.id} className="rounded-lg border border-border/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.label}</span>
              <span
                className={`text-xs ${
                  p.configured ? "text-emerald-500" : "text-muted-foreground"
                }`}
              >
                {p.configured ? t("gateway.configured") : t("gateway.notConfigured")}
              </span>
              {p.connected && (
                <span className="text-xs text-emerald-500">{t("gateway.connected")}</span>
              )}
            </div>
            <div className="flex gap-2">
              {p.connected ? (
                <Button size="sm" variant="outline" onClick={() => disconnect(p.id)}>
                  {t("gateway.disconnect")}
                </Button>
              ) : (
                <Button size="sm" onClick={() => connect(p.id)} disabled={!p.configured}>
                  {t("gateway.connect")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              >
                {expanded === p.id ? t("gateway.collapse") : t("gateway.configure")}
              </Button>
            </div>
          </div>
          {expanded === p.id && (
            <div className="mt-3 space-y-2">
              {(FIELDS[p.id] ?? []).map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-sm">
                    {t(`gateway.field.${f.labelKey}` as TranslationKey)}
                  </label>
                  <Input
                    type={f.secret ? "password" : "text"}
                    value={values[p.id]?.[f.key] ?? ""}
                    onChange={(e) => setField(p.id, f.key, e.target.value)}
                    className="flex-1"
                  />
                </div>
              ))}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void save(p.id)}>
                  {t("gateway.save")}
                </Button>
              </div>
              {p.id === "weixin" && (
                <div className="mt-2 space-y-2 border-t border-border/40 pt-3">
                  {qrFlow.running ? (
                    <div className="space-y-2">
                      {qrFlow.qrUrl ? (
                        <img
                          src={qrFlow.qrUrl}
                          alt="QR"
                          className="size-56 rounded-lg border border-border/50 bg-white p-2"
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {t("gateway.qrWaiting")}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {qrFlow.statusLabel === "scanned"
                            ? t("gateway.qrScanned")
                            : t("gateway.qrWaiting")}
                        </span>
                        <Button size="sm" variant="ghost" onClick={stopQrLogin}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                      {qrFlow.error && (
                        <div className="text-xs text-destructive">
                          {t("gateway.qrError")}: {qrFlow.error}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Button size="sm" variant="secondary" onClick={() => void startQrLogin(p.id)}>
                        {t("gateway.qrLogin")}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {t("gateway.qrLoginHint")}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {p.id === "qq" && (
                <div className="mt-2 space-y-1 border-t border-border/40 pt-3">
                  <span className="text-xs font-medium">{t("gateway.onebotHelper")}</span>
                  <p className="text-xs text-muted-foreground">{t("gateway.onebotHelperHint")}</p>
                  <pre className="rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                    {t("gateway.onebotCmd")}
                  </pre>
                </div>
              )}
              <div className="mt-3 border-t border-border/40 pt-3 space-y-2">
                <span className="text-sm font-medium">{t("gateway.sendTest")}</span>
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-sm">{t("gateway.chatId")}</label>
                  <Input
                    value={testChatId[p.id] ?? ""}
                    onChange={(e) =>
                      setTestChatId((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    className="flex-1"
                    placeholder={t("gateway.chatIdHint")}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-32 shrink-0 text-sm">{t("gateway.messageText")}</label>
                  <Input
                    value={testText[p.id] ?? ""}
                    onChange={(e) => setTestText((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={testGroup[p.id] ?? false}
                      onChange={(e) =>
                        setTestGroup((prev) => ({ ...prev, [p.id]: e.target.checked }))
                      }
                    />
                    {t("gateway.groupChat")}
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => sendTest(p.id)}
                    disabled={!p.configured}
                  >
                    {t("gateway.send")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("gateway.sessionsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("gateway.sessionsHint")}</p>
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("gateway.noSessions")}</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.session_key}
            className="flex items-center justify-between rounded-md border border-border/50 p-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{s.platform}</span>
              <span className="text-muted-foreground">{s.chat_id}</span>
              <span
                className={`text-xs ${
                  s.authorized ? "text-emerald-500" : "text-amber-500"
                }`}
              >
                {s.authorized
                  ? t("gateway.approved")
                  : t("gateway.awaitingApproval")}
              </span>
            </div>
            <div className="flex gap-1">
              {!s.authorized ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void invoke("gateway_authorize", { session_key: s.session_key }).then(
                      refreshSessions,
                    )
                  }
                >
                  {t("gateway.approve")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void invoke("gateway_revoke", { session_key: s.session_key }).then(
                      refreshSessions,
                    )
                  }
                >
                  {t("gateway.revoke")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void invoke("gateway_auto_approve", {
                    session_key: s.session_key,
                    value: !s.auto_approve,
                  }).then(refreshSessions)
                }
              >
                {s.auto_approve
                  ? `${t("gateway.autoApprove")} ✓`
                  : t("gateway.autoApprove")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { type JSX, useEffect, useState } from "react";

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
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";

/**
 * Typed IPC surface for the IM gateway commands. Centralizes the command-name
 * + payload shape so UI code never hand-writes `invoke("gateway_*", …)`, and so
 * a serde rename on the Rust side is caught in one place instead of silently
 * drifting across the settings UI and sidebar.
 */

export type PlatformStatus = {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
};

export type SessionInfo = {
  session_key: string;
  platform: string;
  chat_type: string;
  chat_id: string;
  authorized: boolean;
  auto_approve: boolean;
  awaiting_approval: boolean;
  last_active_ms: number;
};

export type CallbackUrlInfo = {
  id: string;
  url: string | null;
};

export function gatewayPlatforms(): Promise<PlatformStatus[]> {
  return invoke<PlatformStatus[]>("gateway_platforms");
}

export function gatewayCallbackUrls(): Promise<CallbackUrlInfo[]> {
  return invoke<CallbackUrlInfo[]>("gateway_callback_urls");
}

export function gatewaySessions(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("gateway_sessions");
}

export function gatewayConfigure(
  platform: string,
  configJson: string,
): Promise<void> {
  return invoke("gateway_configure", { platform, configJson });
}

export function gatewayConnect(platform: string): Promise<void> {
  return invoke("gateway_connect", { platform });
}

export function gatewayDisconnect(platform: string): Promise<void> {
  return invoke("gateway_disconnect", { platform });
}

export function gatewaySend(
  platform: string,
  chatId: string,
  text: string,
  group: boolean,
): Promise<void> {
  return invoke("gateway_send", { platform, chatId, text, group });
}

export function gatewayAuthorize(sessionKey: string): Promise<void> {
  return invoke("gateway_authorize", { session_key: sessionKey });
}

export function gatewayRevoke(sessionKey: string): Promise<void> {
  return invoke("gateway_revoke", { session_key: sessionKey });
}

export function gatewayAutoApprove(
  sessionKey: string,
  value: boolean,
): Promise<void> {
  return invoke("gateway_auto_approve", { session_key: sessionKey, value });
}

export function gatewayWeixinPersist(frame: {
  account_id: string;
  token: string;
  base_url: string;
}): Promise<void> {
  return invoke("gateway_weixin_persist", frame);
}

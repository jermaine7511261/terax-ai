import { invoke } from "@tauri-apps/api/core";

export type WsMessage = {
  id: string;
  platform: string;
  direction: "incoming" | "outgoing";
  from: string;
  text: string;
  timestamp: string;
};

export type WsConnectionStatus = {
  platform: string;
  connected: boolean;
  url: string;
  message_count: number;
  last_error: string | null;
};

export async function wsStart(platform: string, url: string): Promise<void> {
  return invoke("ws_start", { platform, url });
}

export async function wsStop(platform: string): Promise<void> {
  return invoke("ws_stop", { platform });
}

export async function wsStopAll(): Promise<void> {
  return invoke("ws_stop_all");
}

export async function wsStatus(): Promise<WsConnectionStatus[]> {
  return invoke("ws_status");
}

export async function wsSend(platform: string, text: string): Promise<void> {
  return invoke("ws_send", { platform, text });
}

export async function wsMessages(platform: string, limit?: number): Promise<WsMessage[]> {
  return invoke("ws_messages", { platform, limit: limit ?? 50 });
}

import { invoke } from "@tauri-apps/api/core";

export type GatewayMessage = {
  id: string;
  platform: string;
  from: string;
  text: string;
  timestamp: string;
  direction: string;
};

export type GatewayConfig = {
  id: string;
  platform: string;
  name: string;
  token?: string | null;
  webhook_url?: string | null;
  chat_id?: string | null;
  enabled: boolean;
};

export async function listConfigs(): Promise<GatewayConfig[]> {
  return invoke("gateway_list");
}

export async function saveConfig(config: GatewayConfig): Promise<void> {
  return invoke("gateway_save", { config });
}

export async function deleteConfig(id: string): Promise<void> {
  return invoke("gateway_delete", { id });
}

export async function getMessages(platform?: string, limit?: number): Promise<GatewayMessage[]> {
  return invoke("gateway_messages", { platform, limit });
}

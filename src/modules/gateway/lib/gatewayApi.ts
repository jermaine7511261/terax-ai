import { invoke } from "@tauri-apps/api/core";

export type GatewayConfig = {
  id: string;
  platform: string;
  name: string;
  token: string | null;
  webhook_url: string | null;
  chat_id: string | null;
  enabled: boolean;
};

export type GatewayMessage = {
  id: string;
  platform: string;
  from: string;
  text: string;
  timestamp: string;
  direction: string;
};

export async function listGatewayConfigs(): Promise<GatewayConfig[]> {
  return invoke("gateway_list");
}

export async function saveGatewayConfig(config: GatewayConfig): Promise<void> {
  return invoke("gateway_save", { config });
}

export async function deleteGatewayConfig(id: string): Promise<void> {
  return invoke("gateway_delete", { id });
}

export async function getGatewayMessages(
  platform?: string,
  limit?: number,
): Promise<GatewayMessage[]> {
  return invoke("gateway_messages", {
    platform: platform ?? null,
    limit: limit ?? 50,
  });
}

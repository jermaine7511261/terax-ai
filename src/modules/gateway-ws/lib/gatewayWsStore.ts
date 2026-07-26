import { create } from "zustand";
import type { GatewayConfig, GatewayMessage } from "./gatewayWsApi";
import * as api from "./gatewayWsApi";

type GatewayState = {
  configs: GatewayConfig[];
  messages: GatewayMessage[];
  connected: boolean;
  loading: boolean;
  loadConfigs: () => Promise<void>;
  loadMessages: (platform?: string) => Promise<void>;
  saveConfig: (config: GatewayConfig) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
};

export const useGatewayStore = create<GatewayState>((set, get) => ({
  configs: [],
  messages: [],
  connected: false,
  loading: false,
  loadConfigs: async () => {
    set({ loading: true });
    try { set({ configs: await api.listConfigs(), loading: false }); }
    catch { set({ loading: false }); }
  },
  loadMessages: async (platform) => {
    try { set({ messages: await api.getMessages(platform) }); }
    catch {}
  },
  saveConfig: async (config) => {
    await api.saveConfig(config);
    await get().loadConfigs();
  },
  deleteConfig: async (id) => {
    await api.deleteConfig(id);
    await get().loadConfigs();
  },
}));

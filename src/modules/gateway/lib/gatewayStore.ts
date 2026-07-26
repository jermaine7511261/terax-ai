import { create } from "zustand";
import type { GatewayConfig, GatewayMessage } from "./gatewayApi";

type GatewayStore = {
  configs: GatewayConfig[];
  messages: GatewayMessage[];
  isLoading: boolean;
  setConfigs: (c: GatewayConfig[]) => void;
  setMessages: (m: GatewayMessage[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useGatewayStore = create<GatewayStore>((set) => ({
  configs: [],
  messages: [],
  isLoading: false,
  setConfigs: (c) => set({ configs: c }),
  setMessages: (m) => set({ messages: m }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

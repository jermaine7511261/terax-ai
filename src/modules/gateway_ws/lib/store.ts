import { create } from "zustand";
import type { WsConnectionStatus, WsMessage } from "./api";

type GatewayWsStore = {
  connections: WsConnectionStatus[];
  messages: WsMessage[];
  isLoading: boolean;
  setConnections: (c: WsConnectionStatus[]) => void;
  setMessages: (m: WsMessage[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useGatewayWsStore = create<GatewayWsStore>((set) => ({
  connections: [],
  messages: [],
  isLoading: false,
  setConnections: (c) => set({ connections: c }),
  setMessages: (m) => set({ messages: m }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

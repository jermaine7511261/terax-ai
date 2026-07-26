import { create } from "zustand";
import type { McpServerConfig, McpTool } from "./mcpApi";

type McpStore = {
  servers: McpServerConfig[];
  tools: McpTool[];
  isLoading: boolean;
  setServers: (s: McpServerConfig[]) => void;
  setTools: (t: McpTool[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useMcpStore = create<McpStore>((set) => ({
  servers: [],
  tools: [],
  isLoading: false,
  setServers: (s) => set({ servers: s }),
  setTools: (t) => set({ tools: t }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

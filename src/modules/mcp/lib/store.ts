import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  mcpServerAdd,
  mcpServerConnect,
  mcpServerDisconnect,
  mcpServerList,
  mcpServerRefresh,
  mcpServerRemove,
  type McpServerConfig,
  type McpServerInfo,
} from "./api";

type McpStatusEvent = {
  serverId: string;
  status: McpServerInfo["status"];
  error?: string | null;
};

type McpStore = {
  servers: McpServerInfo[];
  loaded: boolean;
  busy: Record<string, boolean>;
  refresh: () => Promise<void>;
  add: (config: McpServerConfig) => Promise<void>;
  remove: (id: string) => Promise<void>;
  connect: (id: string, root: string | null) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  refreshServer: (id: string) => Promise<void>;
  patch: (id: string, status: McpServerInfo["status"], error?: string | null) => void;
};

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  loaded: false,
  busy: {},

  refresh: async () => {
    const servers = await mcpServerList();
    set({ servers, loaded: true });
  },

  add: async (config) => {
    await mcpServerAdd(config);
    await get().refresh();
  },

  remove: async (id) => {
    await mcpServerRemove(id);
    await get().refresh();
  },

  connect: async (id, root) => {
    set((s) => ({ busy: { ...s.busy, [id]: true } }));
    try {
      await mcpServerConnect(id, root, null);
      await get().refresh();
    } finally {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[id];
        return { busy };
      });
    }
  },

  disconnect: async (id) => {
    await mcpServerDisconnect(id);
    await get().refresh();
  },

  refreshServer: async (id) => {
    await mcpServerRefresh(id);
    await get().refresh();
  },

  patch: (id, status, error = null) => {
    set((s) => ({
      servers: s.servers.map((sv) =>
        sv.id === id ? { ...sv, status, error: error ?? sv.error } : sv,
      ),
    }));
  },
}));

let statusListener: Promise<() => void> | null = null;

/** Wire the Rust `yamet:mcp-status` events into the store (once). */
export function useMcpStatusBridge(): void {
  if (statusListener) return;
  statusListener = listen<McpStatusEvent>("yamet:mcp-status", (e) => {
    useMcpStore.getState().patch(e.payload.serverId, e.payload.status, e.payload.error ?? null);
  });
}

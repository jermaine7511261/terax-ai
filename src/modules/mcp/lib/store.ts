import { create } from "zustand";
import { listen } from "@/platform";
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

// §3.1.1 / §3.6.1 MCP preset configurations (one-click install)
export interface McpPreset {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command: string;
  args: string[];
  enabled: boolean;
  description: string;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "terminator",
    name: "Terminator (Windows Computer-Use)",
    transport: "stdio",
    command: "terminator-mcp",
    args: [],
    enabled: false,
    description: "Windows desktop computer-use: screenshots, mouse/keyboard control, element locating",
  },
  {
    id: "computer-use-linux",
    name: "Computer-Use Linux (AT-SPI)",
    transport: "stdio",
    command: "computer-use-linux",
    args: ["--transport", "stdio"],
    enabled: false,
    description: "Linux desktop computer-use: AT-SPI accessibility tree, semantic selectors",
  },
  {
    id: "fetchira",
    name: "Fetchira (Search + Image Gen)",
    transport: "stdio",
    command: "fetchira",
    args: ["mcp"],
    enabled: false,
    description: "Search / deep research / image generation / browser automation",
  },
];

type McpStatusEvent = {
  serverId: string;
  status: McpServerInfo["status"];
  error?: string | null;
};

type McpStore = {
  servers: McpServerInfo[];
  loaded: boolean;
  busy: Record<string, boolean>;
  presets: McpPreset[];
  refresh: () => Promise<void>;
  add: (config: McpServerConfig) => Promise<void>;
  addPreset: (preset: McpPreset) => Promise<void>;
  remove: (id: string) => Promise<void>;
  connect: (id: string, root?: string | null) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  refreshServer: (id: string) => Promise<void>;
  patch: (id: string, status: McpServerInfo["status"], error?: string | null) => void;
};

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  loaded: false,
  busy: {},
  presets: MCP_PRESETS,

  refresh: async () => {
    const servers = await mcpServerList();
    set({ servers, loaded: true });
  },

  add: async (config) => {
    await mcpServerAdd(config);
    await get().refresh();
  },

  addPreset: async (preset) => {
    await get().add({
      id: preset.id,
      name: preset.name,
      transport: preset.transport,
      command: preset.command,
      args: preset.args,
    } as unknown as McpServerConfig);
  },

  remove: async (id) => {
    await mcpServerRemove(id);
    await get().refresh();
  },

  connect: async (id, root = null) => {
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

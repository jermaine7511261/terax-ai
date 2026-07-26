import { invoke } from "@tauri-apps/api/core";

export type McpServerConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export type McpTool = {
  server_id: string;
  name: string;
  description: string | null;
  input_schema: unknown;
};

export async function listMcpServers(): Promise<McpServerConfig[]> {
  return invoke("mcp_list_servers");
}

export async function registerMcpServer(config: McpServerConfig): Promise<void> {
  return invoke("mcp_register_server", { config });
}

export async function unregisterMcpServer(id: string): Promise<void> {
  return invoke("mcp_unregister_server", { id });
}

export async function listMcpTools(): Promise<McpTool[]> {
  return invoke("mcp_list_tools");
}

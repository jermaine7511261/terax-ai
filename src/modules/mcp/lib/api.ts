import { invoke } from "@/platform";

export type McpTransportType = "stdio" | "sse";

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export type McpResourceInfo = {
  uri: string;
  name: string;
  description: string;
};

export type McpPromptInfo = {
  name: string;
  description: string;
};

export type McpServerInfo = {
  id: string;
  name: string;
  transport: McpTransportType;
  status: "disconnected" | "connecting" | "connected" | "error";
  error: string | null;
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  prompts: McpPromptInfo[];
};

export type McpServerConfig = {
  id: string;
  name: string;
  transport: McpTransportType;
  // stdio
  command?: string;
  args?: string[];
  env?: { name: string; value: string }[];
  // sse
  url?: string;
  headers?: { name: string; value: string }[];
  /** Working directory the stdio child runs in, pinned at config time. */
  cwd?: string;
};

export function mcpServerList(): Promise<McpServerInfo[]> {
  return invoke("mcp_server_list");
}

export function mcpServerAdd(config: McpServerConfig): Promise<void> {
  return invoke("mcp_server_add", { config });
}

export function mcpServerRemove(id: string): Promise<void> {
  return invoke("mcp_server_remove", { id });
}

export function mcpServerConnect(
  id: string,
  root: string | null,
  workspace: unknown,
): Promise<void> {
  return invoke("mcp_server_connect", { id, root, workspace });
}

export function mcpServerDisconnect(id: string): Promise<void> {
  return invoke("mcp_server_disconnect", { id });
}

export function mcpServerRefresh(id: string): Promise<number> {
  return invoke("mcp_server_refresh", { id });
}

export function mcpToolCall(id: string, name: string, args: unknown): Promise<unknown> {
  return invoke("mcp_tool_call", { id, name, arguments: args });
}

export function mcpResourceRead(id: string, uri: string): Promise<unknown> {
  return invoke("mcp_resource_read", { id, uri });
}

import { jsonSchema, tool, type Tool } from "ai";
import { mcpToolCall } from "@/modules/mcp";
import { useMcpStore } from "@/modules/mcp";

/**
 * Registers tools from every connected MCP server into the AI tool surface.
 * Tool names are namespaced (`mcp_<server>_<tool>`) and sanitized to the
 * SDK's allowed charset. Execution routes through the native Rust MCP client.
 */
export function buildMcpTools(): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  const servers = useMcpStore.getState().servers;
  for (const server of servers) {
    if (server.status !== "connected") continue;
    for (const t of server.tools) {
      const name = sanitizeToolName(`mcp_${server.id}_${t.name}`);
      if (!name || out[name]) continue;
      const schema =
        t.inputSchema && typeof t.inputSchema === "object"
          ? t.inputSchema
          : { type: "object", properties: {} };
      try {
        out[name] = tool({
          description:
            t.description || `MCP tool ${t.name} (server: ${server.name})`,
          inputSchema: jsonSchema(schema as never),
          execute: async (args) => {
            const res = await mcpToolCall(server.id, t.name, args);
            return formatMcpResult(res);
          },
        });
      } catch {
        // Malformed input schema; skip the tool rather than breaking the run.
      }
    }
  }
  return out;
}

function sanitizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

function formatMcpResult(res: unknown): string {
  if (!res || typeof res !== "object") return String(res);
  const r = res as {
    content?: unknown[];
    isError?: boolean;
  };
  const parts = (r.content ?? []).map((p) => {
    if (!p || typeof p !== "object") return String(p);
    const part = p as Record<string, unknown>;
    if (typeof part.text === "string") return part.text;
    if ("image" in part) return "[image]";
    if ("resource" in part) {
      const uri = (part.resource as { uri?: string } | undefined)?.uri ?? "";
      return `[resource: ${uri}]`;
    }
    return JSON.stringify(p);
  });
  const text = parts.join("\n").trim();
  if (r.isError) return `[MCP error] ${text || JSON.stringify(res)}`;
  return text || JSON.stringify(res);
}

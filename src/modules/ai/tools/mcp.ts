import { jsonSchema, tool, type Tool } from "ai";
import { mcpToolCall } from "@/modules/mcp";
import { useMcpStore } from "@/modules/mcp";
import { formatMcpResult, sanitizeToolName } from "../lib/mcpFormat";

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

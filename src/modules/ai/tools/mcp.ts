import { tool, type FlexibleSchema, type Tool } from "ai";
import {
  jsonSchemaToZod,
  mcpCall,
  sanitizeMcpToolName,
} from "../lib/mcp";
import { redactSensitive } from "../lib/redact";
import { useMcpStore } from "../store/mcpStore";

/**
 * Build the dynamic tool registry from the live MCP store.
 *
 * Every MCP tool is treated as untrusted:
 *  - `needsApproval: true` — the AI SDK pauses and the UI surfaces the
 *    existing approval card (same flow as built-in mutating tools).
 *  - `execute` forwards the (already zod-validated) args to the backend
 *    JSON-RPC `tools/call` and redacts the result before it reaches the
 *    conversation, mirroring session-persistence redaction.
 *
 * Synchronous: reads `useMcpStore.getState()` at tool-build time, so the
 * transport must `await refreshMcpTools()` before each run (see transport.ts).
 */
export function buildMcpTools(): Record<string, Tool<unknown, unknown>> {
  const { tools } = useMcpStore.getState();
  const out: Record<string, Tool<unknown, unknown>> = {};
  for (const t of tools) {
    const key = sanitizeMcpToolName(t.server_id, t.name);
    const description = [
      t.description?.trim() || `Tool "${t.name}" from MCP server.`,
      `Source: MCP server "${t.server_name}" (requires approval).`,
    ]
      .filter(Boolean)
      .join("\n\n");
    out[key] = tool({
      description,
      // Remote schemas are JSON Schema; the converter already falls back to
      // a permissive object, so cast to the SDK's flexible-schema shape.
      inputSchema: jsonSchemaToZod(t.input_schema) as FlexibleSchema<unknown>,
      needsApproval: true,
      execute: async (args: unknown) => {
        const raw = await mcpCall(t.server_id, t.name, args);
        // Redact secrets inside stringly results before they persist.
        if (typeof raw === "string") return redactSensitive(raw);
        try {
          return JSON.parse(redactSensitive(JSON.stringify(raw ?? null)));
        } catch {
          return raw;
        }
      },
    }) as Tool<unknown, unknown>;
  }
  return out;
}

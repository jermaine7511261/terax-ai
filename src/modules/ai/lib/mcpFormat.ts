/**
 * Pure formatting helpers for MCP tool registration (leaf module).
 * Extracted from tools/mcp.ts so the sanitize/format logic is unit-testable
 * without the AI SDK tool wrapper or the MCP store.
 */

/** Sanitize an MCP tool name to the SDK's allowed charset + length. */
export function sanitizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

type McpResultPart = {
  text?: unknown;
  image?: unknown;
  resource?: unknown;
} & Record<string, unknown>;

/** Format an MCP tool-call result (content parts) into a readable string. */
export function formatMcpResult(res: unknown): string {
  if (!res || typeof res !== "object") return String(res);
  const r = res as {
    content?: unknown[];
    isError?: boolean;
  };
  const parts = (r.content ?? []).map((p) => {
    if (!p || typeof p !== "object") return String(p);
    const part = p as McpResultPart;
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

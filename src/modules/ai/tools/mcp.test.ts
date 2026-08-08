import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mcpToolCall: vi.fn(),
  servers: [] as unknown[],
}));

vi.mock("@/modules/mcp", () => ({
  mcpToolCall: h.mcpToolCall,
  useMcpStore: { getState: () => ({ servers: h.servers }) },
}));

import { buildMcpTools } from "./mcp";
import { formatMcpResult, sanitizeToolName } from "../lib/mcpFormat";

function connectedServer(overrides: Record<string, unknown> = {}) {
  return {
    id: "srv1",
    name: "Server One",
    status: "connected",
    tools: [
      { name: "read_file", description: "Read a file", inputSchema: null },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  h.mcpToolCall.mockReset();
  h.mcpToolCall.mockResolvedValue({ ok: true });
  h.servers.length = 0;
});

describe("buildMcpTools", () => {
  it("registers nothing with no servers", () => {
    expect(buildMcpTools()).toEqual({});
  });

  it("skips servers that are not connected", () => {
    h.servers.push(connectedServer({ status: "connecting" }));
    expect(buildMcpTools()).toEqual({});
  });

  it("registers a namespaced tool per connected server tool", () => {
    h.servers.push(connectedServer());
    const tools = buildMcpTools();
    const name = sanitizeToolName("mcp_srv1_read_file");
    expect(Object.keys(tools)).toEqual([name]);
    expect(tools[name].description).toBe("Read a file");
  });

  it("uses a fallback description when missing", () => {
    h.servers.push(connectedServer({ tools: [{ name: "x", description: "" }] }));
    const tools = buildMcpTools();
    const name = sanitizeToolName("mcp_srv1_x");
    expect(tools[name].description).toBe("MCP tool x (server: Server One)");
  });

  it("falls back to an empty object schema when inputSchema is absent", () => {
    h.servers.push(connectedServer());
    const tools = buildMcpTools();
    expect(tools).not.toEqual({});
  });

  it("skips duplicate names after sanitization", () => {
    h.servers.push(
      connectedServer({ id: "srv1" }),
      connectedServer({ id: "srv1", tools: [{ name: "read_file" }] }),
    );
    const tools = buildMcpTools();
    expect(Object.keys(tools)).toHaveLength(1);
  });

  it("executes by routing through mcpToolCall and formatting the result", async () => {
    h.servers.push(connectedServer());
    const tools = buildMcpTools();
    const name = sanitizeToolName("mcp_srv1_read_file");
    const execute = tools[name].execute as
      | ((args: Record<string, unknown>) => Promise<unknown>)
      | undefined;
    expect(execute).toBeTypeOf("function");
    h.mcpToolCall.mockResolvedValue({ content: [{ type: "text", text: "hi" }] });
    const run = execute as (args: Record<string, unknown>) => Promise<unknown>;
    const out = await run({ path: "/a" });
    expect(h.mcpToolCall).toHaveBeenCalledWith("srv1", "read_file", {
      path: "/a",
    });
    expect(out).toEqual(formatMcpResult({ content: [{ type: "text", text: "hi" }] }));
  });
});

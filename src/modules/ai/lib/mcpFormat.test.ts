import { describe, expect, it } from "vitest";
import { formatMcpResult, sanitizeToolName } from "./mcpFormat";

describe("sanitizeToolName", () => {
  it("lowercases", () => {
    expect(sanitizeToolName("mcp_Server_Tool")).toBe("mcp_server_tool");
  });

  it("replaces illegal chars with underscore", () => {
    expect(sanitizeToolName("mcp_srv_tool$#@")).toBe("mcp_srv_tool");
  });

  it("collapses repeated underscores", () => {
    expect(sanitizeToolName("mcp__srv___tool")).toBe("mcp_srv_tool");
  });

  it("strips leading/trailing underscores", () => {
    expect(sanitizeToolName("_mcp_tool_")).toBe("mcp_tool");
  });

  it("truncates to 60 chars", () => {
    const long = `mcp_${"a".repeat(100)}`;
    expect(sanitizeToolName(long).length).toBe(60);
  });

  it("keeps alphanumeric, underscore, hyphen", () => {
    expect(sanitizeToolName("mcp_srv-1_ok")).toBe("mcp_srv-1_ok");
  });
});

describe("formatMcpResult", () => {
  it("returns empty for null/undefined", () => {
    expect(formatMcpResult(null)).toBe("null");
    expect(formatMcpResult(undefined)).toBe("undefined");
  });

  it("formats text content parts", () => {
    const res = { content: [{ type: "text", text: "hello" }] };
    expect(formatMcpResult(res)).toBe("hello");
  });

  it("joins multiple content parts with newline", () => {
    const res = {
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    };
    expect(formatMcpResult(res)).toBe("a\nb");
  });

  it("renders image as placeholder", () => {
    const res = { content: [{ type: "image", image: "..." }] };
    expect(formatMcpResult(res)).toBe("[image]");
  });

  it("renders resource with uri", () => {
    const res = {
      content: [{ type: "resource", resource: { uri: "file:///x" } }],
    };
    expect(formatMcpResult(res)).toBe("[resource: file:///x]");
  });

  it("prefixes error results", () => {
    const res = { content: [{ type: "text", text: "boom" }], isError: true };
    expect(formatMcpResult(res)).toBe("[MCP error] boom");
  });

  it("falls back to JSON for unknown object", () => {
    const res = { content: [] };
    expect(formatMcpResult(res)).toBe('{"content":[]}');
  });
});

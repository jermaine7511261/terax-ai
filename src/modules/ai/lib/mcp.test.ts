import { describe, expect, it } from "vitest";
import { jsonSchemaToZod, sanitizeMcpToolName } from "./mcp";

describe("sanitizeMcpToolName", () => {
  it("builds mcp_<serverId>_<toolName> from arbitrary names", () => {
    expect(sanitizeMcpToolName("My Server", "do_Thing")).toBe(
      "mcp_my_server_do_thing",
    );
    expect(sanitizeMcpToolName("filesystem", "list-directory")).toBe(
      "mcp_filesystem_list_directory",
    );
  });

  it("falls back when inputs produce empty slugs", () => {
    expect(sanitizeMcpToolName("!!!", "???")).toBe("mcp_server_tool");
  });

  it("is stable across case and separators", () => {
    const a = sanitizeMcpToolName("Git Hub", "search issues");
    const b = sanitizeMcpToolName("git-hub", "search_issues");
    expect(a).toBe(b);
  });
});

describe("jsonSchemaToZod", () => {
  it("maps string + enum", () => {
    const z = jsonSchemaToZod({ type: "string", enum: ["a", "b"] });
    expect(z.safeParse("a").success).toBe(true);
    expect(z.safeParse("z").success).toBe(false);
  });

  it("maps object with required and optional props", () => {
    const z = jsonSchemaToZod({
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
      required: ["path"],
    });
    expect(z.safeParse({ path: "/x" }).success).toBe(true);
    expect(z.safeParse({}).success).toBe(false);
    // passthrough: unknown keys are allowed (remote servers may add fields)
    expect(z.safeParse({ path: "/x", extra: 1 }).success).toBe(true);
  });

  it("maps arrays with item schema", () => {
    const z = jsonSchemaToZod({
      type: "array",
      items: { type: "integer" },
    });
    expect(z.safeParse([1, 2]).success).toBe(true);
    expect(z.safeParse([1.5]).success).toBe(false);
  });

  it("falls back to a permissive object for unsupported shapes", () => {
    const z = jsonSchemaToZod({ oneOf: [{ type: "string" }] });
    expect(z.safeParse({ anything: true }).success).toBe(true);
    expect(z.safeParse(42).success).toBe(false);
  });

  it("returns permissive object for null / garbage", () => {
    expect(jsonSchemaToZod(null).safeParse({}).success).toBe(true);
    expect(jsonSchemaToZod("nope").safeParse({}).success).toBe(true);
  });
});

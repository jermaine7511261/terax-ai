import { describe, expect, it } from "vitest";
import { deriveGraphId, parseGraphDef } from "./graphParse";

describe("parseGraphDef", () => {
  it("parses valid graph", () => {
    const r = parseGraphDef('{"name":"x","nodes":[],"edges":[]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.def.name).toBe("x");
      expect(r.def.nodes).toEqual([]);
      expect(r.def.edges).toEqual([]);
    }
  });

  it("rejects invalid JSON", () => {
    const r = parseGraphDef("not json {");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid graph JSON");
  });

  it("rejects missing nodes", () => {
    const r = parseGraphDef('{"edges":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("nodes[]");
  });

  it("rejects missing edges", () => {
    const r = parseGraphDef('{"nodes":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("edges[]");
  });

  it("rejects nodes not being an array", () => {
    const r = parseGraphDef('{"nodes":"x","edges":[]}');
    expect(r.ok).toBe(false);
  });
});

describe("deriveGraphId", () => {
  it("slugs a name", () => {
    const id = deriveGraphId("My Graph", 1234);
    expect(id).toBe("g-my-graph-ya");
  });

  it("falls back to graph when name empty", () => {
    const id = deriveGraphId(undefined, 0);
    expect(id).toMatch(/^g-graph-0$/);
  });

  it("strips leading/trailing dashes", () => {
    const id = deriveGraphId("--x--", 100);
    expect(id).toMatch(/^g-x-/);
  });

  it("is deterministic for same name+time", () => {
    expect(deriveGraphId("A", 99)).toBe(deriveGraphId("A", 99));
  });
});

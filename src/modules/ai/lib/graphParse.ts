/**
 * Pure graph-def parsing helpers (leaf module).
 * Extracted from tools/graph.ts so the graph JSON validation + id derivation
 * are unit-testable without the AI SDK tool wrapper or the graph store.
 */

export type ParsedGraphDef = {
  id?: string;
  name?: string;
  nodes: unknown[];
  edges: unknown[];
};

/** Parse a graph def JSON string, validating the nodes/edges arrays. */
export function parseGraphDef(json: string): {
  ok: true;
  def: ParsedGraphDef;
} | { ok: false; error: string } {
  let parsed: Partial<ParsedGraphDef>;
  try {
    parsed = JSON.parse(json) as Partial<ParsedGraphDef>;
  } catch (e) {
    return { ok: false, error: `invalid graph JSON: ${String(e)}` };
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    return { ok: false, error: "graph must have nodes[] and edges[]" };
  }
  return {
    ok: true,
    def: {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      nodes: parsed.nodes,
      edges: parsed.edges,
    },
  };
}

/**
 * Derive a deterministic graph id from the name (or fall back to a timestamped
 * id). Mirrors graph.ts: `g-<name>-<base36 ts>`.
 */
export function deriveGraphId(
  name: string | undefined,
  now: number = Date.now(),
): string {
  const slug = (name ?? "graph")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `g-${slug || "graph"}-${now.toString(36)}`;
}

import { createStorage } from "@/platform";
import type { JournalEntry } from "./types";

/**
 * Journal (H6 checkpoint/resume, grok journal.rs): every graph run snapshots
 * its per-node state to durable storage keyed by a request_hash. On resume,
 * a run with the same graph id + def hash finds its prior entry and continues
 * from the last non-terminal node instead of re-running completed work.
 *
 * Storage is a JSON blob per graphId — a single key write per snapshot keeps
 * it cheap and lets us overwrite (dedup) on re-run.
 */
const STORE_PATH = "yamet-ai-graph-journal.json";
const KEY_PREFIX = "journal:";

const store = createStorage(STORE_PATH);

export function hashGraphDef(def: {
  id: string;
  nodes: { id: string; kind: string; agent?: string; prompt?: string }[];
  edges: { from: string; to: string }[];
}): string {
  // request_hash: deterministic JSON of the graph structure (excluding runtime
  // state), so a structurally identical re-run maps to the same journal entry.
  return JSON.stringify({
    id: def.id,
    nodes: def.nodes.map((n) => [n.id, n.kind, n.agent ?? "", n.prompt ?? ""]),
    edges: def.edges.map((e) => [e.from, e.to]),
  });
}

export async function saveJournalEntry(entry: JournalEntry): Promise<void> {
  try {
    await store.set(`${KEY_PREFIX}${entry.graphId}`, entry);
  } catch {
    // Non-fatal: journaling is best-effort.
  }
}

export async function loadJournalEntry(
  graphId: string,
  requestHash: string,
): Promise<JournalEntry | null> {
  try {
    const entry = await store.get<JournalEntry>(`${KEY_PREFIX}${graphId}`);
    if (!entry || entry.requestHash !== requestHash) return null;
    return entry;
  } catch {
    return null;
  }
}

import { createStorage } from "@/platform";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SerializedTab } from "./serialize";

export type SpaceMeta = {
  id: string;
  name: string;
  root: string | null;
  env: WorkspaceEnv;
  /** Opt-in accent, index into SPACE_COLORS. Undefined = theme primary. */
  color?: number;
  createdAt: number;
  updatedAt: number;
};

export type SpaceState = {
  tabs: SerializedTab[];
  activeTabIndex: number;
};

const STORE_PATH = "yamet-spaces.json";
const KEY_SPACES = "spaces";
const KEY_ACTIVE = "activeId";
const KEY_RECENT = "recent";
const STATE_PREFIX = "state:";
const RECENT_LIMIT = 8;
const stateKey = (id: string) => `${STATE_PREFIX}${id}`;

const store = createStorage(STORE_PATH);

export type LoadedSpaces = {
  spaces: SpaceMeta[];
  activeId: string | null;
  recent: string[];
  states: Map<string, SpaceState>;
};

export async function loadAll(): Promise<LoadedSpaces> {
  let entries: Array<[string, unknown]>;
  try {
    entries = await store.entries();
  } catch {
    // Store file corrupt / unreadable (crash mid-write, disk error). Fall back
    // to an empty default rather than failing startup and losing the whole
    // workspace — matches the per-entry corruption skip in hydrateTabs.
    return { spaces: [], activeId: null, recent: [], states: new Map() };
  }
  let spaces: SpaceMeta[] = [];
  let activeId: string | null = null;
  let recent: string[] = [];
  const states = new Map<string, SpaceState>();
  for (const [k, v] of entries) {
    if (k === KEY_SPACES) spaces = (v as SpaceMeta[]) ?? [];
    else if (k === KEY_ACTIVE) activeId = (v as string | null) ?? null;
    else if (k === KEY_RECENT) recent = (v as string[]) ?? [];
    else if (k.startsWith(STATE_PREFIX)) {
      states.set(k.slice(STATE_PREFIX.length), v as SpaceState);
    }
  }
  return { spaces, activeId, recent, states };
}

export async function saveSpacesList(spaces: SpaceMeta[]): Promise<void> {
  await store.set(KEY_SPACES, spaces);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export async function saveRecent(list: string[]): Promise<void> {
  await store.set(KEY_RECENT, list.slice(0, RECENT_LIMIT));
}

/**
 * Insert an id at the front of a recently-opened list: deduped, capped at
 * RECENT_LIMIT, most recent first. Pure so it is trivially testable and so the
 * zustand store can reuse it for both push and set.
 */
export function recentWith(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
}

/**
 * Resolve a persisted recent-id list into the spaces that still exist, most
 * recent first, excluding the currently active space. Pure and testable.
 */
export function recentSpaces(
  recent: string[],
  spaces: SpaceMeta[],
  activeId: string | null,
): SpaceMeta[] {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const out: SpaceMeta[] = [];
  for (const id of recent) {
    if (id === activeId) continue;
    const s = byId.get(id);
    if (s) {
      out.push(s);
      byId.delete(id);
    }
  }
  return out;
}

export async function saveState(id: string, state: SpaceState): Promise<void> {
  await store.set(stateKey(id), state);
}

export async function deleteSpaceData(id: string): Promise<void> {
  await store.delete(stateKey(id));
}

export function newSpaceId(): string {
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

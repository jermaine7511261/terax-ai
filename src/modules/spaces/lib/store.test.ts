// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => {
  const memory = new Map<string, unknown>();
  class LazyStore {
    static _memory = memory;
    async entries() {
      return Array.from(memory.entries());
    }
    async set(k: string, v: unknown) {
      memory.set(k, v);
    }
    async get(k: string) {
      return memory.get(k);
    }
    async delete(k: string) {
      memory.delete(k);
    }
    async save() {}
  }
  return { LazyStore };
});

import {
  deleteSpaceData,
  loadAll,
  newSpaceId,
  recentWith,
  saveActiveId,
  saveRecent,
  saveSpacesList,
  saveState,
  type SpaceMeta,
} from "./store";

const space: SpaceMeta = {
  id: "sp-1",
  name: "Work",
  root: "/ws",
  env: { kind: "local" },
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(async () => {
  // Reset the fake store backing map between tests.
  const mod = vi.mocked(await import("@tauri-apps/plugin-store"));
  // @ts-expect-error private test hook
  mod.LazyStore._memory.clear();
});

describe("newSpaceId", () => {
  it("returns a sp- prefixed id", () => {
    expect(newSpaceId()).toMatch(/^sp-/);
  });
});

describe("loadAll / save helpers", () => {
  it("returns empty state when nothing is stored", async () => {
    const loaded = await loadAll();
    expect(loaded.spaces).toEqual([]);
    expect(loaded.activeId).toBeNull();
    expect(loaded.states.size).toBe(0);
  });

  it("round-trips the spaces list, active id, and per-space states", async () => {
    await saveSpacesList([space]);
    await saveActiveId("sp-1");
    await saveState("sp-1", { tabs: [], activeTabIndex: 0 });

    const loaded = await loadAll();
    expect(loaded.spaces).toEqual([space]);
    expect(loaded.activeId).toBe("sp-1");
    expect(loaded.states.get("sp-1")).toEqual({ tabs: [], activeTabIndex: 0 });
  });

  it("treats a stored active id as null when it is null", async () => {
    await saveSpacesList([space]);
    await saveActiveId(null);
    const loaded = await loadAll();
    expect(loaded.activeId).toBeNull();
  });

  it("deleteSpaceData removes the per-space state", async () => {
    await saveState("sp-1", { tabs: [], activeTabIndex: 0 });
    await deleteSpaceData("sp-1");
    const loaded = await loadAll();
    expect(loaded.states.has("sp-1")).toBe(false);
  });
});

describe("recentWith", () => {
  it("prepends an id and dedupes", () => {
    expect(recentWith(["a", "b"], "c")).toEqual(["c", "a", "b"]);
    expect(recentWith(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("caps the list at 8, most recent first", () => {
    let list: string[] = [];
    for (let i = 0; i < 10; i++) list = recentWith(list, `id-${i}`);
    expect(list.length).toBe(8);
    expect(list[0]).toBe("id-9");
    expect(list[7]).toBe("id-2");
  });
});

describe("recent persistence", () => {
  it("returns an empty recent list when nothing is stored", async () => {
    const loaded = await loadAll();
    expect(loaded.recent).toEqual([]);
  });

  it("round-trips the recent list", async () => {
    await saveRecent(["sp-1", "sp-2"]);
    const loaded = await loadAll();
    expect(loaded.recent).toEqual(["sp-1", "sp-2"]);
  });

  it("caps saved recent at 8", async () => {
    await saveRecent(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    const loaded = await loadAll();
    expect(loaded.recent).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });
});

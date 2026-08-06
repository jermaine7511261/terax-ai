import { describe, expect, it, vi } from "vitest";

// A store whose entries() throws — simulates a corrupt / unreadable store file
// (crash mid-write, disk error). loadAll must fall back to an empty default
// instead of failing startup.
vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    async entries(): Promise<Array<[string, unknown]>> {
      throw new Error("corrupt store file");
    }
    async set() {}
    async get() {
      return undefined;
    }
    async delete() {}
  }
  return { LazyStore };
});

import { loadAll } from "./store";

describe("loadAll corrupt-store resilience", () => {
  it("falls back to empty default when the store file is unreadable", async () => {
    const loaded = await loadAll();
    expect(loaded.spaces).toEqual([]);
    expect(loaded.activeId).toBeNull();
    expect(loaded.recent).toEqual([]);
    expect(loaded.states.size).toBe(0);
  });
});

// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from "vitest";

const favoriteModelIds = vi.fn();
const recentModelIds = vi.fn();
const setFavoriteModelIds = vi.fn(async () => {});
const setRecentModelIds = vi.fn(async () => {});

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({
      favoriteModelIds: favoriteModelIds(),
      recentModelIds: recentModelIds(),
    }),
  },
}));

vi.mock("@/modules/settings/store", () => ({
  setFavoriteModelIds: (v: string[]) => setFavoriteModelIds(v),
  setRecentModelIds: (v: string[]) => setRecentModelIds(v),
}));

import { toggleFavoriteModel, pushRecentModel } from "./modelPrefs";

describe("toggleFavoriteModel", () => {
  beforeEach(() => {
    setFavoriteModelIds.mockClear();
  });

  it("adds an id not present", async () => {
    favoriteModelIds.mockReturnValue(["a"]);
    await toggleFavoriteModel("b");
    expect(setFavoriteModelIds).toHaveBeenCalledWith(["a", "b"]);
  });

  it("removes an id already present", async () => {
    favoriteModelIds.mockReturnValue(["a", "b"]);
    await toggleFavoriteModel("a");
    expect(setFavoriteModelIds).toHaveBeenCalledWith(["b"]);
  });
});

describe("pushRecentModel", () => {
  beforeEach(() => {
    setRecentModelIds.mockClear();
  });

  it("prepends a new model and dedupes", async () => {
    recentModelIds.mockReturnValue(["b", "c"]);
    await pushRecentModel("a");
    expect(setRecentModelIds).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("moves an existing model to front", async () => {
    recentModelIds.mockReturnValue(["a", "b"]);
    await pushRecentModel("b");
    expect(setRecentModelIds).toHaveBeenCalledWith(["b", "a"]);
  });

  it("does not persist when nothing changed", async () => {
    recentModelIds.mockReturnValue(["a"]);
    await pushRecentModel("a");
    expect(setRecentModelIds).not.toHaveBeenCalled();
  });

  it("caps recents at RECENTS_MAX (5)", async () => {
    recentModelIds.mockReturnValue(["a", "b", "c", "d", "e"]);
    await pushRecentModel("z");
    expect(setRecentModelIds).toHaveBeenCalledWith([
      "z",
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

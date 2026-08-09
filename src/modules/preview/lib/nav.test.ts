import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBookmarks, navBack, navForward, pushNav, toggleBookmark } from "./nav";

const KEY = "YaMet.preview.bookmarks";

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  vi.stubGlobal(
    "window",
    { localStorage } as unknown as Window & typeof globalThis,
  );
  return { map, localStorage };
}

afterEach(() => vi.unstubAllGlobals());

describe("pushNav", () => {
  it("appends a new url and advances the index", () => {
    const h = { urls: ["a"], index: 0 };
    expect(pushNav(h, "b")).toEqual({ urls: ["a", "b"], index: 1 });
  });

  it("is a no-op (same reference) for the current url", () => {
    const h = { urls: ["a", "b"], index: 1 };
    expect(pushNav(h, "b")).toBe(h);
  });

  it("truncates forward history after navigating back", () => {
    const h = { urls: ["a", "b", "c"], index: 1 };
    expect(pushNav(h, "d")).toEqual({ urls: ["a", "b", "d"], index: 2 });
  });

  it("does not mutate the input", () => {
    const h = { urls: ["a", "b"], index: 0 };
    pushNav(h, "c");
    expect(h.urls).toEqual(["a", "b"]);
  });
});

describe("navBack / navForward", () => {
  it("moves backward and returns null at the start", () => {
    expect(navBack({ urls: ["a", "b"], index: 1 })).toEqual({
      urls: ["a", "b"],
      index: 0,
    });
    expect(navBack({ urls: ["a"], index: 0 })).toBeNull();
  });

  it("moves forward and returns null at the end", () => {
    expect(navForward({ urls: ["a", "b"], index: 0 })).toEqual({
      urls: ["a", "b"],
      index: 1,
    });
    expect(navForward({ urls: ["a"], index: 0 })).toBeNull();
  });
});

describe("bookmarks", () => {
  it("loads [] when storage is empty", () => {
    stubStorage();
    expect(loadBookmarks()).toEqual([]);
  });

  it("parses stored json and filters non-string entries", () => {
    stubStorage({ [KEY]: JSON.stringify(["a", 1, null, "b"]) });
    expect(loadBookmarks()).toEqual(["a", "b"]);
  });

  it("returns [] on corrupt json", () => {
    stubStorage({ [KEY]: "{oops" });
    expect(loadBookmarks()).toEqual([]);
  });

  it("adds new urls to the front and persists", () => {
    const { localStorage } = stubStorage();
    expect(toggleBookmark(["a"], "b")).toEqual({
      list: ["b", "a"],
      added: true,
    });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual(["b", "a"]);
  });

  it("removes existing urls and persists", () => {
    const { localStorage } = stubStorage();
    expect(toggleBookmark(["b", "a"], "b")).toEqual({
      list: ["a"],
      added: false,
    });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual(["a"]);
  });

  it("swallows storage write failures (private mode)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {},
      },
    });
    expect(toggleBookmark([], "a")).toEqual({ list: ["a"], added: true });
  });
});

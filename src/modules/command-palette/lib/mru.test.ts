// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mruRank, mruSnapshot, recordUse } from "./mru";

const KEY = "yamet-palette-mru";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("mru (most-recently-used) ranking", () => {
  it("starts with an empty snapshot", () => {
    expect(mruSnapshot()).toEqual({});
  });

  it("records a use timestamp for an id", () => {
    recordUse("settings.open");
    const snap = mruSnapshot();
    expect(Object.keys(snap)).toEqual(["settings.open"]);
    expect(snap["settings.open"]).toEqual(expect.any(Number));
  });

  it("mruRank returns 0 for unknown ids", () => {
    expect(mruRank({}, "nope")).toBe(0);
    expect(mruRank({ known: 123 }, "other")).toBe(0);
  });

  it("mruRank returns the stored timestamp", () => {
    expect(mruRank({ known: 123 }, "known")).toBe(123);
  });

  it("records multiple ids independently", () => {
    recordUse("a");
    recordUse("b");
    expect(Object.keys(mruSnapshot()).sort()).toEqual(["a", "b"]);
  });

  it("evicts the least-recently-used entries past the cap", () => {
    // Insert more than MAX_ENTRIES (120) with increasing timestamps.
    for (let i = 0; i < 125; i++) recordUse(`cmd-${i}`);
    const snap = mruSnapshot();
    expect(Object.keys(snap).length).toBe(120);
    // The oldest ids (cmd-0 ... ) must have been evicted.
    expect(snap["cmd-0"]).toBeUndefined();
    expect(snap["cmd-124"]).toBeDefined();
  });

  it("tolerates a corrupt stored payload", () => {
    localStorage.setItem(KEY, "{not json");
    expect(mruSnapshot()).toEqual({});
  });
});

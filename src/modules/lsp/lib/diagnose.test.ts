import { describe, expect, it } from "vitest";
import { buildLineShift } from "./diagnose";

// buildLineShift returns Map<beforeLine, afterLine> for lines that survived
// the edit. Used to shift the pre-edit diagnostic baseline so a mid-file
// insertion does not re-report pre-existing errors below the edit point.

describe("buildLineShift", () => {
  it("maps identity for an unchanged file", () => {
    const before = ["a", "b", "c", "d"];
    const map = buildLineShift(before, [...before]);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(2);
    expect(map.get(3)).toBe(3);
  });

  it("shifts lines down when lines are inserted in the middle", () => {
    const before = ["a", "b", "c", "d"];
    const after = ["a", "X", "Y", "b", "c", "d"];
    const map = buildLineShift(before, after);
    // "a" stayed at index 0; "b" (before idx 1) is now index 3.
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(3);
    expect(map.get(2)).toBe(4);
    expect(map.get(3)).toBe(5);
  });

  it("maps a pre-existing error line below an insertion to the shifted line", () => {
    const before = ["a", "b", "c", "d"];
    const after = ["a", "b", "c", "NEW1", "NEW2", "d"];
    const map = buildLineShift(before, after);
    // "d" (before idx 3) moved down by 2.
    expect(map.get(3)).toBe(5);
  });

  it("collapses lines up on deletion", () => {
    const before = ["a", "b", "c", "d"];
    const after = ["a", "c", "d"];
    const map = buildLineShift(before, after);
    expect(map.get(0)).toBe(0);
    // "b" deleted; "c" (before idx 2) now at idx 1.
    expect(map.get(2)).toBe(1);
    expect(map.get(3)).toBe(2);
  });

  it("returns empty map when a side exceeds the LCS cap", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `line${i}`);
    const map = buildLineShift(big, [...big]);
    expect(map.size).toBe(0);
  });

  it("returns empty map for empty input", () => {
    expect(buildLineShift([], ["a"]).size).toBe(0);
    expect(buildLineShift(["a"], []).size).toBe(0);
  });

  it("handles insertion at the very top", () => {
    const before = ["a", "b", "c"];
    const after = ["TOP", "a", "b", "c"];
    const map = buildLineShift(before, after);
    expect(map.get(0)).toBe(1);
    expect(map.get(2)).toBe(3);
  });

  it("handles insertion at the very bottom", () => {
    const before = ["a", "b", "c"];
    const after = ["a", "b", "c", "TAIL"];
    const map = buildLineShift(before, after);
    expect(map.get(0)).toBe(0);
    expect(map.get(2)).toBe(2);
  });

  it("survives duplicate identical lines", () => {
    const before = ["x", "x", "y"];
    const after = ["x", "x", "x", "y"];
    const map = buildLineShift(before, after);
    // Both original "x" lines map into the run of three "x" lines.
    expect(map.has(0)).toBe(true);
    expect(map.has(1)).toBe(true);
    expect(map.get(2)).toBe(3);
  });
});

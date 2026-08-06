import { describe, expect, it } from "vitest";
import {
  filterMatches,
  groupByFile,
  highlightRanges,
  type SearchHitLike,
} from "./filter";

const hit = (
  rel: string,
  text: string,
  line = 0,
): SearchHitLike & { line: number } => ({ rel, text, line });

describe("highlightRanges", () => {
  it("returns an empty list for a blank query", () => {
    expect(highlightRanges("foo bar", "")).toEqual([]);
  });

  it("finds a single occurrence", () => {
    expect(highlightRanges("foo bar baz", "bar")).toEqual([
      { start: 4, end: 7 },
    ]);
  });

  it("finds multiple, non-overlapping occurrences", () => {
    expect(highlightRanges("the cat sat", "at")).toEqual([
      { start: 5, end: 7 },
      { start: 9, end: 11 },
    ]);
  });

  it("matches case-insensitively but keeps original offsets", () => {
    expect(highlightRanges("Foo FOO foo", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("returns an empty list when there is no match", () => {
    expect(highlightRanges("abc", "z")).toEqual([]);
  });
});

describe("filterMatches", () => {
  const hits = [
    hit("a.ts", "const greeting = 1"),
    hit("a.ts", "no match here"),
    hit("b.ts", "GREETING"),
  ];

  it("returns everything for a blank query", () => {
    expect(filterMatches(hits, "  ").length).toBe(3);
  });

  it("keeps only hits whose text mentions the query", () => {
    expect(filterMatches(hits, "greeting").map((h) => h.rel)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("does not mutate the input array", () => {
    const before = [...hits];
    filterMatches(hits, "greeting");
    expect(hits).toEqual(before);
  });
});

describe("groupByFile", () => {
  const hits = [
    hit("b.ts", "x"),
    hit("a.ts", "y"),
    hit("a.ts", "z"),
    hit("b.ts", "w"),
  ];

  it("groups by rel and sorts entries by path", () => {
    const groups = groupByFile(hits);
    expect(groups.map(([rel]) => rel)).toEqual(["a.ts", "b.ts"]);
    expect(groups[0][1].map((h) => h.text)).toEqual(["y", "z"]);
  });

  it("returns an empty array for no hits", () => {
    expect(groupByFile([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyFastContextBudget,
  fastContextPrompt,
  prioritizePrecision,
  type FileMatch,
} from "./fastContext";

describe("applyFastContextBudget (S7)", () => {
  it("keeps matches within the file cap", () => {
    const matches: FileMatch[] = Array.from({ length: 20 }, (_, i) => ({
      path: `/a/${i}.ts`,
      startLine: 1,
      endLine: 50,
    }));
    const out = applyFastContextBudget(matches, { maxFiles: 5, maxLinesPerFile: 100, maxTokens: 99999 });
    expect(out.matches.length).toBe(5);
  });

  it("trims line ranges to the per-file cap", () => {
    const matches: FileMatch[] = [{ path: "/a/x.ts", startLine: 1, endLine: 500 }];
    const out = applyFastContextBudget(matches, { maxFiles: 5, maxLinesPerFile: 100, maxTokens: 99999 });
    expect(out.matches[0].endLine).toBe(100);
  });

  it("stops when the token budget is exhausted", () => {
    // Each match = 100 lines * 40 / 4 = 1000 tokens. Budget 2500 → 2 fit,
    // the 3rd would exceed → stops at 2.
    const matches: FileMatch[] = Array.from({ length: 10 }, (_, i) => ({
      path: `/a/${i}.ts`,
      startLine: 1,
      endLine: 100,
    }));
    const out = applyFastContextBudget(matches, { maxFiles: 10, maxLinesPerFile: 100, maxTokens: 2500 });
    expect(out.matches.length).toBe(2);
  });

  it("estimates tokens from line count when text is absent", () => {
    const out = applyFastContextBudget(
      [{ path: "/a/x.ts", startLine: 1, endLine: 40 }],
      { maxFiles: 5, maxLinesPerFile: 100, maxTokens: 99999 },
    );
    expect(out.tokens).toBeGreaterThan(0);
  });
});

describe("prioritizePrecision (S7)", () => {
  it("sorts by query-term hits then smaller range", () => {
    const matches: FileMatch[] = [
      { path: "/a/broad.ts", startLine: 1, endLine: 200, text: "parse the config and the schema" },
      { path: "/a/precise.ts", startLine: 10, endLine: 12, text: "config parse" },
    ];
    const out = prioritizePrecision(matches, ["config", "parse"], 2);
    expect(out[0].path).toBe("/a/precise.ts"); // more terms hit + smaller range
  });

  it("caps to the precision limit", () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({ path: `/a/${i}.ts` }));
    expect(prioritizePrecision(matches, ["x"], 3).length).toBe(3);
  });

  it("returns as-is when no query terms", () => {
    const matches: FileMatch[] = [{ path: "/a/1.ts" }, { path: "/a/2.ts" }];
    expect(prioritizePrecision(matches, [], 10)).toEqual(matches);
  });
});

describe("fastContextPrompt (S7)", () => {
  it("declares the caps", () => {
    const p = fastContextPrompt();
    expect(p).toContain("10 files");
    expect(p).toContain("100 lines");
    expect(p).toContain("4000 tokens");
    expect(p).toContain("Prioritize precision");
  });
});

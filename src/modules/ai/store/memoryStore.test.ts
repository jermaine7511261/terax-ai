import { describe, expect, it } from "vitest";
import {
  formatSessionMemory,
  getSessionMemory,
  recallScore,
  recallTop,
} from "./memoryStore";

function entry(content: string, id: string) {
  return { content, id, createdAt: 1 };
}

describe("formatSessionMemory", () => {
  it("returns null for empty array", () => {
    expect(formatSessionMemory([])).toBeNull();
  });

  it("formats single entry", () => {
    const result = formatSessionMemory([entry("remember this", "1")]);
    expect(result).toContain("<yamet-session-memory>");
    expect(result).toContain("- remember this");
    expect(result).toContain("</yamet-session-memory>");
  });

  it("formats multiple entries", () => {
    const result = formatSessionMemory([
      entry("first", "1"),
      entry("second", "2"),
    ]);
    expect(result).toContain("- first");
    expect(result).toContain("- second");
  });

  it("strips newlines from entries", () => {
    const result = formatSessionMemory([
      entry("line1\nline2\nline3", "1"),
    ]);
    expect(result).toContain("- line1 line2 line3");
    expect(result).not.toContain("\nline2");
  });

  it("strips \\r\\n from entries", () => {
    const result = formatSessionMemory([entry("a\r\nb", "1")]);
    expect(result).toContain("- a b");
  });
});

describe("getSessionMemory", () => {
  it("returns empty array for null sessionId", () => {
    expect(getSessionMemory(null)).toEqual([]);
  });
});

describe("recallScore (P1-4 relevance)", () => {
  it("returns 1 for an exact full-token match", () => {
    expect(recallScore("we use pnpm for package management", "pnpm")).toBe(1);
  });
  it("returns 0 when no query token appears", () => {
    expect(recallScore("nothing here", "pnpm")).toBe(0);
  });
  it("ignores stopwords and short tokens", () => {
    expect(recallScore("unrelated text", "how the")).toBe(0);
  });
  it("returns partial score when some tokens match", () => {
    const s = recallScore("configure pnpm settings", "pnpm build");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  it("recalls CJK lines for a longer sentence query (2-gram overlap)", () => {
    // "记忆注入全量拼接" is one CJK token with no spaces; 2-gram overlap must
    // still hit a line containing "记忆" + "注入".
    const s = recallScore(
      "- 2026-08-07 记忆注入层重构为召回式注入",
      "记忆注入全量拼接 召回式注入",
    );
    expect(s).toBeGreaterThan(0);
  });
});

describe("recallTop (P1-4 ranked recall)", () => {
  const lines = [
    "- we use pnpm for dependencies",
    "- the build command is pnpm build",
    "- deploy to the staging server",
  ];
  it("ranks the most relevant line first for a query", () => {
    const top = recallTop(lines, "pnpm build");
    expect(top[0]).toContain("pnpm");
  });
  it("respects the limit", () => {
    expect(recallTop(lines, "pnpm", { limit: 1 }).length).toBe(1);
  });
  it("returns empty when nothing scores above threshold", () => {
    expect(recallTop(lines, "quantum physics", { threshold: 0.9 })).toEqual([]);
  });
  it("returns empty lines / query safely", () => {
    expect(recallTop([], "anything")).toEqual([]);
    expect(recallTop(lines, "")).toEqual([]);
  });
});

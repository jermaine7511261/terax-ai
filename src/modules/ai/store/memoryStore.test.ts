import { describe, expect, it } from "vitest";
import {
  formatSessionMemory,
  getSessionMemory,
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

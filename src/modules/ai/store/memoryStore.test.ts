import { describe, expect, it } from "vitest";
import {
  formatSessionMemory,
  getSessionMemory,
} from "./memoryStore";

describe("formatSessionMemory", () => {
  it("returns null for empty array", () => {
    expect(formatSessionMemory([])).toBeNull();
  });

  it("formats single entry", () => {
    const result = formatSessionMemory([{ content: "remember this", id: "1" }]);
    expect(result).toContain("<yamet-session-memory>");
    expect(result).toContain("- remember this");
    expect(result).toContain("</yamet-session-memory>");
  });

  it("formats multiple entries", () => {
    const result = formatSessionMemory([
      { content: "first", id: "1" },
      { content: "second", id: "2" },
    ]);
    expect(result).toContain("- first");
    expect(result).toContain("- second");
  });

  it("strips newlines from entries", () => {
    const result = formatSessionMemory([
      { content: "line1\nline2\nline3", id: "1" },
    ]);
    expect(result).toContain("- line1 line2 line3");
    expect(result).not.toContain("\nline2");
  });

  it("strips \\r\\n from entries", () => {
    const result = formatSessionMemory([
      { content: "a\r\nb", id: "1" },
    ]);
    expect(result).toContain("- a b");
  });
});

describe("getSessionMemory", () => {
  it("returns empty array for null sessionId", () => {
    expect(getSessionMemory(null)).toEqual([]);
  });
});

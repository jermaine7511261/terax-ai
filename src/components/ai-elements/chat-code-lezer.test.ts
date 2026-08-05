import { describe, expect, it } from "vitest";
import { isHighlightable } from "./chat-code-lezer";

describe("isHighlightable", () => {
  it("returns false for null/undefined/empty lang", () => {
    expect(isHighlightable(null)).toBe(false);
    expect(isHighlightable(undefined)).toBe(false);
    expect(isHighlightable("")).toBe(false);
  });

  it("recognizes common languages", () => {
    expect(isHighlightable("javascript")).toBe(true);
    expect(isHighlightable("typescript")).toBe(true);
    expect(isHighlightable("python")).toBe(true);
    expect(isHighlightable("rust")).toBe(true);
    expect(isHighlightable("markdown")).toBe(true);
    expect(isHighlightable("json")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHighlightable("JavaScript")).toBe(true);
    expect(isHighlightable("TYPESCRIPT")).toBe(true);
  });

  it("returns false for unknown languages", () => {
    expect(isHighlightable("not-a-real-lang")).toBe(false);
    expect(isHighlightable("foobar")).toBe(false);
  });
});

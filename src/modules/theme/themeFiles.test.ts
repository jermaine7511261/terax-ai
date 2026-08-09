// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  isThemeFilePath,
  parseThemeFile,
  starterTheme,
} from "./themeFiles";

describe("isThemeFilePath", () => {
  it("matches .yamet-theme files case-insensitively", () => {
    expect(isThemeFilePath("my-theme.yamet-theme")).toBe(true);
    expect(isThemeFilePath("dir/nested/theme.yamet-theme")).toBe(true);
    expect(isThemeFilePath("My-THEME.YaMet-THEME")).toBe(true);
  });

  it("rejects non-theme extensions and extensionless", () => {
    expect(isThemeFilePath("theme.json")).toBe(false);
    expect(isThemeFilePath("theme")).toBe(false);
    expect(isThemeFilePath("theme.yamet-theme.bak")).toBe(false);
  });
});

describe("parseThemeFile", () => {
  it("returns error for malformed JSON", () => {
    const r = parseThemeFile("{not valid");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe("string");
  });

  it("rejects valid JSON that is not a theme object", () => {
    const r = parseThemeFile(JSON.stringify({ foo: 1 }));
    expect(r.ok).toBe(false);
  });

  it("accepts a valid theme", () => {
    const theme = starterTheme();
    const r = parseThemeFile(JSON.stringify(theme));
    expect(r.ok).toBe(true);
  });
});

describe("starterTheme", () => {
  it("produces unique ids", () => {
    expect(starterTheme().id).not.toBe(starterTheme().id);
  });

  it("has a dark variant with required colors", () => {
    const t = starterTheme();
    expect(t.variants.dark?.colors.background).toBe("#0d0d10");
    expect(t.variants.dark?.colors.primary).toBe("#7dd3fc");
  });

  it("is named My Theme", () => {
    expect(starterTheme().name).toBe("My Theme");
  });
});

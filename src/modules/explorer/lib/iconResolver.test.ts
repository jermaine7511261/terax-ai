import { describe, expect, it } from "vitest";
import { fileIconUrl, folderIconUrl } from "./iconResolver";

const DATA_URL = "data:image/svg+xml;utf8,";

describe("fileIconUrl", () => {
  it("resolves a known extension to a data-url icon", () => {
    const url = fileIconUrl("index.ts");
    expect(url.startsWith(DATA_URL)).toBe(true);
    expect(url.length).toBeGreaterThan(DATA_URL.length);
  });

  it("is consistent for the same extension regardless of basename", () => {
    expect(fileIconUrl("index.ts")).toBe(fileIconUrl("other.ts"));
  });

  it("falls back to the default file icon for unknown extensions", () => {
    const url = fileIconUrl("archive.zzzz");
    expect(url.startsWith(DATA_URL)).toBe(true);
  });

  it("resolves known file names", () => {
    expect(fileIconUrl("biome.json").startsWith(DATA_URL)).toBe(true);
  });
});

describe("folderIconUrl", () => {
  it("resolves a known folder name to a data-url icon", () => {
    const url = folderIconUrl("src", false);
    expect(url.startsWith(DATA_URL)).toBe(true);
  });

  it("returns a different icon when expanded", () => {
    expect(folderIconUrl("src", true)).not.toBe(folderIconUrl("src", false));
  });

  it("falls back to the default folder icon for unknown names", () => {
    const url = folderIconUrl("nonexistent_folder", false);
    expect(url.startsWith(DATA_URL)).toBe(true);
  });

  it("handles case-insensitive folder names", () => {
    expect(folderIconUrl("SRC", false)).toBe(folderIconUrl("src", false));
  });
});

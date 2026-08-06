import { describe, expect, it } from "vitest";
import {
  ALL_LANGUAGES,
  EXPOSED_LANGUAGES,
  LANGUAGES,
  extensionMap,
  filenameMap,
} from "./languageDefinitions";

describe("LANGUAGES", () => {
  it("exposes a non-empty list of language definitions", () => {
    expect(LANGUAGES.length).toBeGreaterThan(0);
  });

  it("keeps extensions unique and non-empty for every language", () => {
    const seen = new Set<string>();
    for (const lang of LANGUAGES) {
      expect(lang.name, lang.name).toBeTruthy();
      expect(lang.extensions.length, lang.name).toBeGreaterThan(0);
      for (const ext of lang.extensions) {
        expect(seen.has(ext), `duplicate ext '${ext}'`).toBe(false);
        seen.add(ext);
      }
    }
  });

  it("covers common languages plus a Markdown entry", () => {
    const names = LANGUAGES.map((l) => l.name);
    expect(names).toContain("JavaScript");
    expect(names).toContain("TypeScript");
    expect(names).toContain("Python");
    expect(names).toContain("Markdown");
  });

  it("excludes languages without an explicit userSelectable flag from pickers", () => {
    const exposedNames = EXPOSED_LANGUAGES.map((l) => l.name);
    // "Yamet Theme" is internal and never user-pickable.
    expect(exposedNames).not.toContain("Yamet Theme");
  });
});

describe("derived language exports", () => {
  it("sorts ALL_LANGUAGES by name and uses the first extension", () => {
    const names = ALL_LANGUAGES.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(ALL_LANGUAGES.length).toBe(LANGUAGES.length);
    for (const l of ALL_LANGUAGES) {
      const def = LANGUAGES.find((d) => d.name === l.name);
      expect(l.ext).toBe(def!.extensions[0]);
    }
  });

  it("EXPOSED_LANGUAGES only includes user-selectable languages", () => {
    expect(EXPOSED_LANGUAGES.length).toBeLessThan(LANGUAGES.length);
    for (const l of EXPOSED_LANGUAGES) {
      const def = LANGUAGES.find((d) => d.name === l.name);
      expect(def?.userSelectable).not.toBe(false);
    }
  });

  it("builds a lowercase extension map to language definitions", () => {
    expect(extensionMap.get("ts")?.name).toBe("TypeScript");
    expect(extensionMap.get("py")?.name).toBe("Python");
    expect(extensionMap.size).toBeGreaterThan(20);
  });

  it("builds a filename map when filenames are declared", () => {
    // At least some languages declare a filename (e.g. Dockerfile / Makefile).
    expect(filenameMap.size).toBeGreaterThan(0);
  });
});

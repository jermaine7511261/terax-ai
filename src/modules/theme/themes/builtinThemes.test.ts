import { describe, expect, it } from "vitest";
import {
  getBuiltinTheme,
  getDefaultTheme,
  listBuiltinThemes,
} from "./index";

describe("builtin themes", () => {
  it("has unique ids across all builtin themes", () => {
    const themes = listBuiltinThemes();
    const ids = themes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every builtin theme has a dark or light variant", () => {
    for (const t of listBuiltinThemes()) {
      expect(
        t.variants.dark !== undefined || t.variants.light !== undefined,
        `theme ${t.id} needs at least one variant`,
      ).toBe(true);
    }
  });

  it("getBuiltinTheme resolves every listed theme by id", () => {
    for (const t of listBuiltinThemes()) {
      expect(getBuiltinTheme(t.id)?.id).toBe(t.id);
    }
  });

  it("getBuiltinTheme returns undefined for unknown ids", () => {
    expect(getBuiltinTheme("does-not-exist")).toBeUndefined();
  });

  it("getDefaultTheme resolves to a valid theme", () => {
    expect(getDefaultTheme()).toBeDefined();
  });
});

describe("newly added themes", () => {
  it("registers monokai with light and dark variants", () => {
    const t = getBuiltinTheme("monokai");
    expect(t?.name).toBe("Monokai");
    expect(t?.variants.dark).toBeDefined();
    expect(t?.variants.light).toBeDefined();
  });

  it("registers one-dark with light and dark variants", () => {
    const t = getBuiltinTheme("one-dark");
    expect(t?.name).toBe("One Dark");
    expect(t?.variants.dark).toBeDefined();
    expect(t?.variants.light).toBeDefined();
  });

  it("registers github-dark with an editor theme mapping", () => {
    const t = getBuiltinTheme("github-dark");
    expect(t?.name).toBe("GitHub Dark");
    expect(t?.variants.dark).toBeDefined();
    expect(t?.variants.light).toBeDefined();
    expect(t?.editorTheme).toEqual({
      dark: "github-dark",
      light: "github-light",
    });
  });
});

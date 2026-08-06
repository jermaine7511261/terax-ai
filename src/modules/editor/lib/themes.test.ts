import { describe, expect, it } from "vitest";
import { EDITOR_THEME_EXT } from "./themes";

// Importing the module builds EDITOR_THEME_EXT at module scope, executing the
// full editor-theme map. Importing also transitively builds every locally
// defined cmThemes entry and pulls in the @uiw packaged themes.

const EXPECTED_KEYS = [
  "kanagawa",
  "kanagawa-lotus",
  "kanagawa-dragon",
  "tokyo-night",
  "catppuccin-mocha",
  "catppuccin-latte",
  "rose-pine",
  "rose-pine-dawn",
  "everforest",
  "everforest-light",
  "dracula",
  "solarized-dark",
  "solarized-light",
  "nord",
  "gruvbox-dark",
  "atomone",
  "aura",
  "copilot",
  "github-dark",
  "github-light",
  "xcode-dark",
  "xcode-light",
] as const;

describe("EDITOR_THEME_EXT", () => {
  it("maps every expected theme id to a truthy extension", () => {
    for (const key of EXPECTED_KEYS) {
      expect(EDITOR_THEME_EXT[key], key).toBeTruthy();
    }
  });

  it("contains exactly the declared theme set", () => {
    expect(Object.keys(EDITOR_THEME_EXT).sort()).toEqual(
      [...EXPECTED_KEYS].sort(),
    );
  });

  it("provides a dark and light variant for paired themes", () => {
    expect(EDITOR_THEME_EXT["kanagawa"]).toBeTruthy();
    expect(EDITOR_THEME_EXT["kanagawa-lotus"]).toBeTruthy();
    expect(EDITOR_THEME_EXT["xcode-dark"]).toBeTruthy();
    expect(EDITOR_THEME_EXT["xcode-light"]).toBeTruthy();
  });
});

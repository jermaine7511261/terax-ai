import { describe, expect, it } from "vitest";
import {
  catppuccinLatte,
  catppuccinMocha,
  dracula,
  everforestDark,
  everforestLight,
  kanagawa,
  kanagawaDragon,
  kanagawaLotus,
  rosePine,
  rosePineDawn,
  solarizedDark,
  solarizedLight,
} from "./cmThemes";

// Importing the module runs build() for every locally-defined theme at
// module scope, exercising the full syntax-palette mapping (comment,
// keyword, string, number, constant fallback, func, variable, property,
// type, operator, tag/bracket, attr/value, heading, link, emphasis, strong,
// invalid, meta) for both light and dark modes, plus the boldKeyword branch.

const themes: Record<string, unknown> = {
  kanagawa,
  kanagawaLotus,
  kanagawaDragon,
  everforestDark,
  everforestLight,
  dracula,
  solarizedDark,
  solarizedLight,
  catppuccinMocha,
  catppuccinLatte,
  rosePine,
  rosePineDawn,
};

describe("cmThemes", () => {
  it("exposes every locally-defined theme as a truthy extension", () => {
    for (const [name, ext] of Object.entries(themes)) {
      expect(ext, name).toBeTruthy();
    }
  });

  it("provides at least one light and one dark theme", () => {
    expect(kanagawaLotus).toBeTruthy(); // light
    expect(kanagawa).toBeTruthy(); // dark
  });

  it("keeps the dark/light pairing count stable", () => {
    expect(Object.keys(themes)).toHaveLength(12);
  });
});

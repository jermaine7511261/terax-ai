import { describe, expect, it } from "vitest";
import { chromeTheme } from "./chromeTheme";

// Importing the module runs all module-load code: iconMask(), iconRules()
// (light + dark), lintRules() (light + dark), modeTheme(), the `chrome`
// theme spec and the frozen THEME array. These are pure data transforms with
// no DOM dependency (detectMonoFontFamily() falls back to a static chain
// when `document` is undefined in the node test env).

describe("chromeTheme", () => {
  it("returns the frozen theme bundle with the three chrome extensions", () => {
    const theme = chromeTheme();
    expect(theme).toHaveLength(3);
    expect(Object.isFrozen(theme)).toBe(true);
  });

  it("exposes non-null extensions for light, dark and base chrome", () => {
    const exts = chromeTheme() as unknown as unknown[];
    for (const ext of exts) {
      expect(ext).toBeTruthy();
    }
  });

  it("returns the same cached instance on every call", () => {
    expect(chromeTheme()).toBe(chromeTheme());
  });
});

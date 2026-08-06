import { describe, expect, it } from "vitest";
import {
  buildSharedExtensions,
  indentExtension,
  languageCompartment,
  readOnlyCompartment,
  vimCompartment,
  wrapCompartment,
  lspCompartment,
  indentCompartment,
  debugCompartment,
} from "./extensions";

describe("extensions", () => {
  it("builds a tab indent extension with tab size 4", () => {
    const ext = indentExtension("\t");
    expect(Array.isArray(ext)).toBe(true);
    expect(ext).toHaveLength(2);
  });

  it("uses the unit length as tab size for non-tab units", () => {
    const ext = indentExtension("    ");
    expect(Array.isArray(ext)).toBe(true);
    expect(ext).toHaveLength(2);
  });

  it("returns the frozen shared extension singleton", () => {
    const shared = buildSharedExtensions();
    expect(Object.isFrozen(shared)).toBe(true);
    expect(buildSharedExtensions()).toBe(shared);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("exposes all compartment singletons", () => {
    expect(languageCompartment).toBeDefined();
    expect(readOnlyCompartment).toBeDefined();
    expect(vimCompartment).toBeDefined();
    expect(wrapCompartment).toBeDefined();
    expect(lspCompartment).toBeDefined();
    expect(indentCompartment).toBeDefined();
    expect(debugCompartment).toBeDefined();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readTerminalTokens } from "./tokens";

describe("readTerminalTokens", () => {
  it("returns an object with all expected token keys", () => {
    // jsdom's getComputedStyle returns '' for unresolved custom props; the
    // resolve() helper maps each key via style.color = var(--...).
    vi.stubGlobal("getComputedStyle", () => ({ color: "rgb(1, 2, 3)" }));
    const tokens = readTerminalTokens();
    expect(typeof tokens).toBe("object");
    expect(tokens).toHaveProperty("background");
    expect(tokens).toHaveProperty("foreground");
    expect(tokens).toHaveProperty("cursor");
    expect(tokens).toHaveProperty("selection");
    vi.unstubAllGlobals();
  });

  it("returns a non-empty object", () => {
    vi.stubGlobal("getComputedStyle", () => ({ color: "#fff" }));
    const tokens = readTerminalTokens();
    expect(Object.keys(tokens).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

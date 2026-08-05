// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, clearTheme } from "./applyTheme";
import type { Theme } from "./types";

// applyTheme/clearTheme mutate document.documentElement.style. We swap in a
// controllable fake style object so setProperty/removeProperty are assertable
// and jsdom's CSSOM doesn't get in the way.
type StyleMock = ReturnType<typeof makeStyleMock>;

function makeStyleMock() {
  const props = new Map<string, string>();
  return {
    setProperty: vi.fn((name: string, value: string) => {
      props.set(name, value);
    }),
    removeProperty: vi.fn((name: string) => {
      props.delete(name);
    }),
    getPropertyValue: vi.fn((name: string) => props.get(name) ?? ""),
    props,
  };
}

const ANSI = [
  "#000000",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#0000ff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
  "#666666",
  "#ff6666",
  "#66ff66",
  "#ffff66",
  "#6666ff",
  "#ff66ff",
  "#66ffff",
  "#ffffff",
] as const;

let style: StyleMock;

function theme(overrides: Partial<Theme> = {}): Theme {
  return {
    id: "t1",
    name: "Test",
    variants: {
      dark: {
        colors: { background: "#111", foreground: "#eee", radius: "8px" },
        terminal: { background: "#000", ansi: [...ANSI] },
      },
      light: {
        colors: { background: "#fff", foreground: "#000" },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  // clearTheme resets the module-level `lastApplied` so each test starts clean.
  clearTheme();
  style = makeStyleMock();
  Object.defineProperty(document.documentElement, "style", {
    configurable: true,
    value: style,
  });
});

describe("applyTheme", () => {
  it("writes the requested mode's color CSS vars", () => {
    applyTheme(theme(), "dark");

    expect(style.setProperty).toHaveBeenCalledWith("--background", "#111");
    expect(style.setProperty).toHaveBeenCalledWith("--foreground", "#eee");
    expect(style.setProperty).toHaveBeenCalledWith("--radius", "8px");
  });

  it("writes terminal palette vars including ansi colors", () => {
    applyTheme(theme(), "dark");

    expect(style.setProperty).toHaveBeenCalledWith(
      "--terminal-background",
      "#000",
    );
    expect(style.setProperty).toHaveBeenCalledWith(
      "--terminal-ansi-red",
      "#ff0000",
    );
    expect(style.setProperty).toHaveBeenCalledWith(
      "--terminal-ansi-bright-white",
      "#ffffff",
    );
  });

  it("clears previously applied vars before writing the new theme", () => {
    applyTheme(theme(), "dark");

    // ALL_VARS are removed first — spot-check a color var, a terminal var, and
    // ansi var.
    expect(style.removeProperty).toHaveBeenCalledWith("--background");
    expect(style.removeProperty).toHaveBeenCalledWith(
      "--terminal-background",
    );
    expect(style.removeProperty).toHaveBeenCalledWith("--terminal-ansi-black");
  });

  it("falls back to the dark variant when the requested mode is missing", () => {
    const t = theme({ variants: { dark: { colors: { background: "#222" } } } });

    applyTheme(t, "light");

    expect(style.setProperty).toHaveBeenCalledWith("--background", "#222");
  });

  it("falls back to the light variant when only light exists", () => {
    const t = theme({ variants: { light: { colors: { background: "#fff" } } } });

    applyTheme(t, "dark");

    expect(style.setProperty).toHaveBeenCalledWith("--background", "#fff");
  });

  it("calls clearTheme (writes nothing) when no variant is available", () => {
    const t = theme({ variants: {} });

    applyTheme(t, "dark");

    expect(style.setProperty).not.toHaveBeenCalled();
    expect(style.removeProperty).not.toHaveBeenCalled();
  });
});

describe("clearTheme", () => {
  it("removes the applied CSS vars after a theme has been applied", () => {
    applyTheme(theme(), "dark");
    style.setProperty.mockClear();

    clearTheme();

    expect(style.removeProperty).toHaveBeenCalledWith("--background");
    expect(style.removeProperty).toHaveBeenCalledWith(
      "--terminal-ansi-bright-white",
    );
    expect(style.getPropertyValue("--background")).toBe("");
  });

  it("is a no-op when nothing has been applied", () => {
    // lastApplied is null at the start of each test.
    clearTheme();

    expect(style.removeProperty).not.toHaveBeenCalled();
  });

  it("allows re-applying a theme after clearing", () => {
    applyTheme(theme(), "dark");
    clearTheme();

    applyTheme(theme(), "light");

    expect(style.setProperty).toHaveBeenCalledWith("--foreground", "#000");
  });
});

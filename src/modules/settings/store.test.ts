import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake in-memory LazyStore + captured event mocks, so store.ts's load/save
// and cross-window broadcast can be exercised without Tauri.
const storeBacking = vi.hoisted(() => ({
  memory: new Map<string, unknown>(),
  localChangeCb: null as ((k: string, v: unknown) => void) | null,
}));
const eventMock = vi.hoisted(() => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn((_event: string, _handler: unknown) =>
    Promise.resolve(() => {}),
  ),
}));

vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    async entries() {
      return Array.from(storeBacking.memory.entries());
    }
    async set(k: string, v: unknown) {
      storeBacking.memory.set(k, v);
    }
    async get(k: string) {
      return storeBacking.memory.get(k);
    }
    async delete(k: string) {
      storeBacking.memory.delete(k);
    }
    async save() {}
    async onChange(cb: (k: string, v: unknown) => void) {
      storeBacking.localChangeCb = cb;
      return () => {};
    }
  }
  return { LazyStore };
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: eventMock.emit,
  listen: eventMock.listen,
}));

import {
  clampAutoSaveDelay,
  clampEditorFontSize,
  coerceFontWeight,
  isEditorThemeId,
  loadPreferences,
  onPreferencesChange,
  setDefaultModel,
  setEditorFontSize,
  setTheme,
  setThemeId,
  setUseNativeAi,
  DEFAULT_PREFERENCES,
} from "./store";

beforeEach(async () => {
  storeBacking.memory.clear();
  storeBacking.localChangeCb = null;
  eventMock.emit.mockClear();
  eventMock.listen.mockClear();
});

describe("pure clamp helpers", () => {
  it("clampEditorFontSize rounds and clamps to [8, 32]", () => {
    expect(clampEditorFontSize(13.4)).toBe(13);
    expect(clampEditorFontSize(100)).toBe(32);
    expect(clampEditorFontSize(-5)).toBe(8);
    expect(clampEditorFontSize(NaN)).toBe(13);
    expect(clampEditorFontSize(Infinity)).toBe(13);
  });

  it("coerceFontWeight accepts known weights and rejects others", () => {
    for (const w of ["normal", "500", "600", "bold"]) {
      expect(coerceFontWeight(w)).toBe(w);
    }
    expect(coerceFontWeight("  bold  ")).toBe("bold");
    expect(coerceFontWeight("italic")).toBe("normal");
    expect(coerceFontWeight("")).toBe("normal");
  });

  it("clampAutoSaveDelay clamps to [100, 60000]", () => {
    expect(clampAutoSaveDelay(1500)).toBe(1500);
    expect(clampAutoSaveDelay(5)).toBe(100);
    expect(clampAutoSaveDelay(1_000_000)).toBe(60_000);
    expect(clampAutoSaveDelay(NaN)).toBe(1000);
  });

  it("isEditorThemeId validates theme ids", () => {
    expect(isEditorThemeId("kanagawa")).toBe(true);
    expect(isEditorThemeId("auto")).toBe(false);
    expect(isEditorThemeId("nope")).toBe(false);
    expect(isEditorThemeId(42)).toBe(false);
  });
});

describe("loadPreferences", () => {
  it("returns all defaults when nothing is stored", async () => {
    const prefs = await loadPreferences();
    expect(prefs).toEqual(DEFAULT_PREFERENCES);
  });

  it("applies stored scalar values", async () => {
    storeBacking.memory.set("theme", "dark");
    storeBacking.memory.set("themeId", "yamet-alternate");
    storeBacking.memory.set("vimMode", true);
    const prefs = await loadPreferences();
    expect(prefs.theme).toBe("dark");
    expect(prefs.themeId).toBe("yamet-alternate");
    expect(prefs.vimMode).toBe(true);
  });

  it("clamps stored numeric ranges on load", async () => {
    storeBacking.memory.set("editorFontSize", 999);
    storeBacking.memory.set("terminalFontWeight", "garbage");
    storeBacking.memory.set("backgroundBlur", 9999);
    storeBacking.memory.set("terminalScrollback", 0);
    storeBacking.memory.set("editorAutoSaveDelay", -5);
    const prefs = await loadPreferences();
    expect(prefs.editorFontSize).toBe(32);
    expect(prefs.terminalFontWeight).toBe("normal");
    expect(prefs.backgroundBlur).toBe(64);
    expect(prefs.terminalScrollback).toBe(200);
    expect(prefs.editorAutoSaveDelay).toBe(100);
  });

  it("rejects unknown model ids and falls back to default", async () => {
    storeBacking.memory.set("defaultModelId", "garbage-model");
    const prefs = await loadPreferences();
    expect(prefs.defaultModelId).toBe(DEFAULT_PREFERENCES.defaultModelId);
  });

  it("keeps a known model id", async () => {
    storeBacking.memory.set("defaultModelId", "deepseek-v4-flash");
    const prefs = await loadPreferences();
    expect(prefs.defaultModelId).toBe("deepseek-v4-flash");
  });

  it("reads the legacy showHiddenDirectories key when showHidden is absent", async () => {
    storeBacking.memory.set("showHiddenDirectories", true);
    const prefs = await loadPreferences();
    expect(prefs.showHidden).toBe(true);
  });

  it("keeps only loadable favorite model ids", async () => {
    storeBacking.memory.set("favoriteModelIds", [
      "deepseek-v4-flash",
      "no-such-model",
    ]);
    const prefs = await loadPreferences();
    expect(prefs.favoriteModelIds).toEqual(["deepseek-v4-flash"]);
  });
});

describe("setters", () => {
  it("persist through the fake store and broadcast the prefs-changed event", async () => {
    await setTheme("light");
    expect(storeBacking.memory.get("theme")).toBe("light");
    expect(eventMock.emit).toHaveBeenCalledWith("yamet://prefs-changed", {
      key: "theme",
      value: "light",
    });
  });

  it("clamp setters before persisting", async () => {
    await setEditorFontSize(999);
    expect(storeBacking.memory.get("editorFontSize")).toBe(32);
    await setDefaultModel("deepseek-v4-flash");
    expect(storeBacking.memory.get("defaultModelId")).toBe("deepseek-v4-flash");
  });

  it("round-trips through loadPreferences", async () => {
    await setTheme("dark");
    await setThemeId("yamet-alt");
    const prefs = await loadPreferences();
    expect(prefs.theme).toBe("dark");
    expect(prefs.themeId).toBe("yamet-alt");
  });

  it("setUseNativeAi persists the dual-track switch and defaults off", async () => {
    // Default is off (frontend AI SDK dual-track path).
    expect(DEFAULT_PREFERENCES.useNativeAi).toBe(false);
    await setUseNativeAi(true);
    expect(storeBacking.memory.get("useNativeAi")).toBe(true);
    expect(eventMock.emit).toHaveBeenCalledWith("yamet://prefs-changed", {
      key: "useNativeAi",
      value: true,
    });
    const prefs = await loadPreferences();
    expect(prefs.useNativeAi).toBe(true);
    await setUseNativeAi(false);
    expect(await loadPreferences()).toMatchObject({ useNativeAi: false });
  });
});

describe("onPreferencesChange", () => {
  it("maps local store change keys to pref names", async () => {
    const cb = vi.fn();
    const unsub = await onPreferencesChange(cb);
    storeBacking.localChangeCb?.("vimMode", true);
    expect(cb).toHaveBeenCalledWith("vimMode", true);
    // Unknown keys are dropped.
    storeBacking.localChangeCb?.("not-a-key", 1);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("forwards cross-window broadcast events from the settings window", async () => {
    const cb = vi.fn();
    await onPreferencesChange(cb);
    expect(eventMock.listen).toHaveBeenCalledWith(
      "yamet://prefs-changed",
      expect.any(Function),
    );
    const handler = eventMock.listen.mock.calls[0]?.[1] as (e: {
      payload: { key: string; value: string };
    }) => void;
    handler({ payload: { key: "themeId", value: "yamet-x" } });
    expect(cb).toHaveBeenCalledWith("themeId", "yamet-x");
  });
});

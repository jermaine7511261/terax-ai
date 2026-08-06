import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyBinding, ShortcutId } from "../shortcuts";

const storeState = vi.hoisted(() => ({
  shortcuts: {} as Record<ShortcutId, KeyBinding[]>,
}));

// Deterministic non-macOS rendering: getBindingTokens must emit "Ctrl …".
vi.mock("@/lib/platform", () => ({ IS_MAC: false, MOD_PROP: "ctrl" }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ shortcuts: storeState.shortcuts }) },
}));

import { shortcutLabel } from "./shortcutLabel";

beforeEach(() => {
  storeState.shortcuts = {} as Record<ShortcutId, KeyBinding[]>;
});

describe("shortcutLabel", () => {
  it("renders the default binding tokens for a shortcut", () => {
    expect(shortcutLabel("tab.new")).toBe("Ctrl T");
  });

  it("renders multi-key defaults", () => {
    expect(shortcutLabel("tab.next")).toBe("Ctrl Tab");
  });

  it("honors a user override", () => {
    storeState.shortcuts["tab.new"] = [{ key: "n" }];
    expect(shortcutLabel("tab.new")).toBe("N");
  });

  it("returns an empty string when the shortcut is unbound", () => {
    storeState.shortcuts["terminal.clear"] = [];
    expect(shortcutLabel("terminal.clear")).toBe("");
  });

  it("falls back to defaults when the user has no binding for a shortcut", () => {
    storeState.shortcuts["pane.splitRight"] = [];
    expect(shortcutLabel("editor.undo")).toBe("Ctrl Z");
  });
});

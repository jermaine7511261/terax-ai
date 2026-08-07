import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@/platform";
import type { Theme } from "./types";

// Module-level singletons created at import time; hoist mocks so the module
// under test picks up the mocked `emit`/`listen`/`LazyStore`.
const { emit, listen, storeMock, LazyStore } = vi.hoisted(() => {
  const storeMock = {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
    onChange: vi.fn(),
  };
  // A class constructor that returns the shared mock instance, so `new
  // LazyStore(...)` in the module under test yields the controllable mock.
  class LazyStore {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: returns shared mock instance intentionally
      return storeMock;
    }
  }
  return {
    emit: vi.fn<(event: string, payload?: unknown) => Promise<void>>(),
    listen: vi.fn<(event: string, cb: () => void) => Promise<UnlistenFn>>(),
    storeMock,
    LazyStore,
  };
});

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));

vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore }));

// Imports must come after mocks are declared (vitest hoists vi.mock anyway).
import {
  deleteCustomTheme,
  listCustomThemes,
  onCustomThemesChange,
  saveCustomTheme,
} from "./customThemes";

const THEME_A: Theme = {
  id: "a",
  name: "Alpha",
  variants: { dark: { colors: { background: "#000" } } },
};

const THEME_B: Theme = {
  id: "b",
  name: "Beta",
  variants: {},
};

const CHANGED_EVENT = "yamet://custom-themes-changed";

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.get.mockResolvedValue([]);
  storeMock.set.mockResolvedValue(undefined);
  storeMock.save.mockResolvedValue(undefined);
  storeMock.onChange.mockResolvedValue(vi.fn() as unknown as UnlistenFn);
  listen.mockResolvedValue(vi.fn() as unknown as UnlistenFn);
});

describe("listCustomThemes", () => {
  it("returns the stored themes when the store holds an array", async () => {
    storeMock.get.mockResolvedValue([THEME_A, THEME_B]);

    await expect(listCustomThemes()).resolves.toEqual([THEME_A, THEME_B]);
    expect(storeMock.get).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when the store holds no themes", async () => {
    storeMock.get.mockResolvedValue(undefined);
    await expect(listCustomThemes()).resolves.toEqual([]);
  });

  it("returns an empty array when the stored value is not an array", async () => {
    storeMock.get.mockResolvedValue({ not: "an array" });
    await expect(listCustomThemes()).resolves.toEqual([]);
  });
});

describe("saveCustomTheme", () => {
  it("appends a new theme to the stored list and emits change", async () => {
    storeMock.get.mockResolvedValue([THEME_B]);

    await saveCustomTheme(THEME_A);

    expect(storeMock.set).toHaveBeenCalledWith("themes", [THEME_B, THEME_A]);
    expect(storeMock.save).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(CHANGED_EVENT);
  });

  it("upserts a theme with the same id instead of duplicating it", async () => {
    storeMock.get.mockResolvedValue([THEME_A, THEME_B]);
    const updated = { ...THEME_A, name: "Alpha v2" };

    await saveCustomTheme(updated);

    expect(storeMock.set).toHaveBeenCalledWith("themes", [THEME_B, updated]);
    expect(storeMock.save).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("deleteCustomTheme", () => {
  it("removes the theme by id and emits change", async () => {
    storeMock.get.mockResolvedValue([THEME_A, THEME_B]);

    await deleteCustomTheme("a");

    expect(storeMock.set).toHaveBeenCalledWith("themes", [THEME_B]);
    expect(storeMock.save).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(CHANGED_EVENT);
  });

  it("does nothing when the id does not exist", async () => {
    storeMock.get.mockResolvedValue([THEME_A, THEME_B]);

    await deleteCustomTheme("missing");

    expect(storeMock.set).not.toHaveBeenCalled();
    expect(storeMock.save).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("onCustomThemesChange", () => {
  let onChangeHandler: ((key: string) => void) | undefined;
  let eventHandler: (() => void) | undefined;

  beforeEach(() => {
    onChangeHandler = undefined;
    eventHandler = undefined;
    storeMock.onChange.mockImplementation(
      (cb: (key: string) => void) =>
        new Promise((resolve) => {
          onChangeHandler = cb;
          resolve(vi.fn() as unknown as UnlistenFn);
        }),
    );
    listen.mockImplementation(
      (_event: string, cb: () => void) =>
        new Promise((resolve) => {
          eventHandler = cb;
          resolve(vi.fn() as unknown as UnlistenFn);
        }),
    );
  });

  it("fires the callback when the store's themes key changes", async () => {
    const cb = vi.fn();
    await onCustomThemesChange(cb);

    expect(onChangeHandler).toBeDefined();
    onChangeHandler!("themes");
    expect(cb).toHaveBeenCalledTimes(1);

    // Other keys are ignored.
    onChangeHandler!("other-key");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires the callback when the changed event is emitted", async () => {
    const cb = vi.fn();
    await onCustomThemesChange(cb);

    expect(eventHandler).toBeDefined();
    expect(listen).toHaveBeenCalledWith(CHANGED_EVENT, expect.any(Function));
    eventHandler!();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("returned unlisten unsubscribes from both sources", async () => {
    storeMock.onChange.mockImplementation(
      (cb: (key: string) => void) =>
        new Promise((resolve) => {
          onChangeHandler = cb;
          resolve(() => {});
        }),
    );
    const unsubEvent = vi.fn(() => {
      eventHandler = undefined;
    });
    listen.mockImplementation(
      (_event: string, cb: () => void) =>
        new Promise((resolve) => {
          eventHandler = cb;
          resolve(unsubEvent as unknown as UnlistenFn);
        }),
    );

    const cb = vi.fn();
    const unlisten = await onCustomThemesChange(cb);
    expect(onChangeHandler).toBeDefined();
    expect(eventHandler).toBeDefined();

    onChangeHandler!("themes");
    eventHandler!();
    expect(cb).toHaveBeenCalledTimes(2);

    unlisten();
    // Event subscription torn down via the returned unlisten.
    expect(unsubEvent).toHaveBeenCalledTimes(1);
    expect(eventHandler).toBeUndefined();
    // Local store subscription torn down — forwarding no longer fires cb.
    onChangeHandler!("themes");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

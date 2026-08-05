import { beforeEach, describe, expect, it, vi } from "vitest";

// snippetsStore imports @tauri-apps/api/event (emit/listen) and ../lib/snippets,
// which constructs a LazyStore from @tauri-apps/plugin-store. Neither Tauri
// module loads cleanly under vitest/node, so mock @tauri-apps/plugin-store at
// module level — the real ../lib/snippets persistence functions run against a
// controllable fake, letting us assert saveDisabledBuiltins' set/save calls.
const { storeMock } = vi.hoisted(() => {
  const storeInstance = {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
  };
  return {
    storeMock: {
      LazyStore: vi.fn(function (this: unknown) {
        return storeInstance;
      }),
      storeInstance,
    },
  };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: storeMock.LazyStore,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { useSnippetsStore } from "./snippetsStore";
import type { Snippet } from "../lib/snippets";

function userSnippet(handle: string, id = `user-${handle}`): Snippet {
  return {
    id,
    handle,
    name: handle,
    description: "",
    content: "hi",
    builtin: false,
  };
}

function builtinSnippet(handle: string, id = `builtin-${handle}`): Snippet {
  return {
    id,
    handle,
    name: handle,
    description: "",
    content: "hi",
    builtin: true,
  };
}

function handles(snippets: Snippet[]): string[] {
  return snippets.map((s) => s.handle).sort();
}

beforeEach(() => {
  useSnippetsStore.setState({
    hydrated: false,
    snippets: [],
    disabledBuiltinHandles: [],
  });
  storeMock.storeInstance.get.mockReset();
  storeMock.storeInstance.set.mockReset();
  storeMock.storeInstance.save.mockReset();
  storeMock.storeInstance.get.mockResolvedValue(null);
  storeMock.storeInstance.set.mockResolvedValue(undefined);
  storeMock.storeInstance.save.mockResolvedValue(undefined);
});

describe("mergeBuiltin", () => {
  it("adds enabled builtins alongside existing user snippets", () => {
    useSnippetsStore.setState({ snippets: [userSnippet("mine")] });

    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("code-review"),
      builtinSnippet("debug"),
    ]);

    const s = useSnippetsStore.getState().snippets;
    expect(handles(s)).toEqual(["code-review", "debug", "mine"]);
    expect(s.filter((x) => x.builtin)).toHaveLength(2);
  });

  it("skips disabled builtins entirely", () => {
    useSnippetsStore.setState({ disabledBuiltinHandles: ["debug"] });

    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("code-review"),
      builtinSnippet("debug"),
    ]);

    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["code-review"]);
  });

  it("lets a user snippet win on handle conflict", () => {
    useSnippetsStore.setState({ snippets: [userSnippet("shared")] });

    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("shared", "builtin-shared"),
    ]);

    const s = useSnippetsStore.getState().snippets;
    expect(s).toHaveLength(1);
    expect(s[0].builtin).toBe(false);
    expect(s[0].id).toBe("user-shared");
  });

  it("replaces previously merged builtins on rescan", () => {
    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("a"),
      builtinSnippet("b"),
    ]);
    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["a", "b"]);

    // A rescan no longer reports "b" — it must be dropped.
    useSnippetsStore.getState().mergeBuiltin([builtinSnippet("a")]);
    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["a"]);
  });

  it("keeps user snippets stable across repeated merges", () => {
    useSnippetsStore.setState({ snippets: [userSnippet("mine")] });

    useSnippetsStore.getState().mergeBuiltin([builtinSnippet("a")]);
    useSnippetsStore.getState().mergeBuiltin([builtinSnippet("b")]);

    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["b", "mine"]);
  });
});

describe("toggleBuiltin + re-scan revives", () => {
  it("disables a builtin and persists the handle", async () => {
    useSnippetsStore.getState().toggleBuiltin("debug", true);

    expect(useSnippetsStore.getState().disabledBuiltinHandles).toEqual(["debug"]);
    expect(storeMock.storeInstance.set).toHaveBeenCalledWith(
      "disabledBuiltinHandles",
      ["debug"],
    );
    // saveDisabledBuiltins is fired-and-forgotten (void), so flush the microtask.
    await new Promise((r) => setTimeout(r, 0));
    expect(storeMock.storeInstance.save).toHaveBeenCalled();
  });

  it("dedupes when disabling an already-disabled handle", () => {
    useSnippetsStore.setState({ disabledBuiltinHandles: ["debug", "x"] });

    useSnippetsStore.getState().toggleBuiltin("debug", true);

    expect(useSnippetsStore.getState().disabledBuiltinHandles).toEqual([
      "debug",
      "x",
    ]);
  });

  it("re-enabling removes the handle from the disabled list and persists", async () => {
    useSnippetsStore.setState({ disabledBuiltinHandles: ["debug", "x"] });

    useSnippetsStore.getState().toggleBuiltin("debug", false);

    expect(useSnippetsStore.getState().disabledBuiltinHandles).toEqual(["x"]);
    expect(storeMock.storeInstance.set).toHaveBeenLastCalledWith(
      "disabledBuiltinHandles",
      ["x"],
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(storeMock.storeInstance.save).toHaveBeenCalled();
  });

  it("re-enabling an unknown handle leaves the list unchanged", () => {
    useSnippetsStore.setState({ disabledBuiltinHandles: [] });

    useSnippetsStore.getState().toggleBuiltin("ghost", false);

    expect(useSnippetsStore.getState().disabledBuiltinHandles).toEqual([]);
  });

  it("a disabled builtin is excluded on rescan and revived after re-enable", () => {
    // First scan brings both in.
    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("a"),
      builtinSnippet("b"),
    ]);
    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["a", "b"]);

    // Disable "b" then rescan — it stays out.
    useSnippetsStore.getState().toggleBuiltin("b", true);
    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("a"),
      builtinSnippet("b"),
    ]);
    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["a"]);

    // Re-enable then rescan — "b" is revived.
    useSnippetsStore.getState().toggleBuiltin("b", false);
    useSnippetsStore.getState().mergeBuiltin([
      builtinSnippet("a"),
      builtinSnippet("b"),
    ]);
    expect(handles(useSnippetsStore.getState().snippets)).toEqual(["a", "b"]);
  });
});

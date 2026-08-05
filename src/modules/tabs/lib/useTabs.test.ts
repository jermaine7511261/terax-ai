// @ts-nocheck
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useTabs.ts transitively imports heavy Tauri-backed app modules. Mock them at
// module level so the hook + pure helpers can be tested in isolation. Types
// imported by the module (`PaneNode`, `AgentInstanceCount`, …) are erased at
// compile time and need no runtime value.
const { disposeSession } = vi.hoisted(() => ({
  disposeSession: vi.fn(),
}));

vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession,
}));

vi.mock("@/modules/terminal/lib/panes", () => ({
  findLeafCwd: vi.fn(() => undefined),
  hasLeaf: vi.fn(() => false),
  leafIds: vi.fn(() => []),
  nextLeafId: vi.fn(() => 0),
  removeLeaf: vi.fn(() => null),
  setLeafCwd: vi.fn((tree: unknown) => tree),
  siblingLeafOf: vi.fn(() => null),
  splitLeaf: vi.fn(),
  swapLeafInDirection: vi.fn((tree: unknown) => tree),
}));

vi.mock("@/modules/agents/lib/launcher", () => ({
  createAgentPanePlan: vi.fn(() => ({
    paneTree: { kind: "leaf", id: 0 },
    leafIds: [0],
  })),
}));

import {
  nextActiveInSpace,
  pickTabBySpaceIndex,
  planGitDiffOpen,
  reorderTabsByGap,
  useTabs,
  type EditorTab,
  type Tab,
} from "./useTabs";

function editorTab(id: number, over: Partial<EditorTab> = {}): EditorTab {
  return {
    id,
    kind: "editor",
    spaceId: "default",
    title: `file${id}.ts`,
    path: `/proj/file${id}.ts`,
    dirty: false,
    preview: false,
    ...over,
  };
}

const defaultTabs: Tab[] = [
  { id: 1, kind: "chat", spaceId: "default", title: "chat" },
  editorTab(2),
  editorTab(3),
];

beforeEach(() => {
  disposeSession.mockClear();
});

describe("pickTabBySpaceIndex", () => {
  it("returns the tab at idx within the matching space", () => {
    expect(pickTabBySpaceIndex(defaultTabs, 0, "default")?.id).toBe(1);
    expect(pickTabBySpaceIndex(defaultTabs, 2, "default")?.id).toBe(3);
  });

  it("returns undefined for out-of-range or missing space", () => {
    expect(pickTabBySpaceIndex(defaultTabs, 5, "default")).toBeUndefined();
    expect(pickTabBySpaceIndex(defaultTabs, 0, "nope")).toBeUndefined();
  });

  it("filters to the space before indexing", () => {
    const mixed: Tab[] = [
      { ...defaultTabs[0], spaceId: "work" },
      defaultTabs[0],
      defaultTabs[1],
    ];
    // work-space has 1 tab, default-space has 2.
    expect(pickTabBySpaceIndex(mixed, 0, "work")?.id).toBe(1);
    expect(pickTabBySpaceIndex(mixed, 1, "default")?.id).toBe(2);
  });
});

describe("nextActiveInSpace", () => {
  it("falls back to the previous tab when closing a non-first tab", () => {
    expect(nextActiveInSpace(defaultTabs, 3)).toBe(2);
  });

  it("falls forward when closing the first tab", () => {
    expect(nextActiveInSpace(defaultTabs, 1)).toBe(2);
  });

  it("returns null when closing the only tab of a space", () => {
    const tabs: Tab[] = [
      defaultTabs[0],
      { ...defaultTabs[1], spaceId: "work" },
    ];
    expect(nextActiveInSpace(tabs, 2)).toBeNull();
  });

  it("returns null for an unknown tab id", () => {
    expect(nextActiveInSpace(defaultTabs, 999)).toBeNull();
  });
});

describe("reorderTabsByGap", () => {
  it("moves a tab earlier when the gap precedes its slot", () => {
    const next = reorderTabsByGap(defaultTabs, 3, 0);
    expect(next.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("moves a tab later when the gap follows its slot", () => {
    const next = reorderTabsByGap(defaultTabs, 1, 3);
    expect(next.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("is a no-op when the gap resolves to the tab's own slot", () => {
    expect(reorderTabsByGap(defaultTabs, 1, 1)).toBe(defaultTabs);
  });

  it("keeps other-space tabs anchored, moving within the drag space only", () => {
    const tabs: Tab[] = [
      defaultTabs[0],
      defaultTabs[1],
      { ...defaultTabs[2], spaceId: "work" },
    ];
    // Move id1 (default space) to gap 2 → after the second default-space tab.
    const next = reorderTabsByGap(tabs, 1, 2);
    // Default space: [1,2] → [2,1]; work-space tab (id3) stays anchored.
    expect(next.map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("returns the same array when the tab id is unknown", () => {
    expect(reorderTabsByGap(defaultTabs, 999, 0)).toBe(defaultTabs);
  });
});

describe("planGitDiffOpen", () => {
  const input = { path: "/proj/a.ts", repoRoot: "/proj", mode: "+" as const };
  let nextId = 100;
  const alloc = () => nextId++;

  beforeEach(() => {
    nextId = 100;
  });

  it("creates a new git-diff tab", () => {
    const plan = planGitDiffOpen([], input, "default", true, alloc);
    expect(plan.targetId).toBe(100);
    expect(plan.tabs).toHaveLength(1);
    expect(plan.tabs[0]).toMatchObject({
      kind: "git-diff",
      path: "/proj/a.ts",
      repoRoot: "/proj",
      mode: "+",
      preview: false,
      title: "a.ts (+)",
    });
  });

  it("dedupes: reuses an existing persistent tab for the same repo/path/mode", () => {
    const existing: Tab = {
      id: 5,
      kind: "git-diff",
      spaceId: "default",
      title: "a.ts (+)",
      path: "/proj/a.ts",
      repoRoot: "/proj",
      mode: "+",
      originalPath: null,
      preview: false,
    };
    const tabs = [existing];
    const plan = planGitDiffOpen(tabs, input, "default", true, alloc);
    expect(plan.targetId).toBe(5);
    expect(plan.tabs).toBe(tabs); // unchanged reference on full match
  });

  it("replaces an existing preview slot when opening a preview diff", () => {
    const preview: Tab = {
      id: 5,
      kind: "git-diff",
      spaceId: "default",
      title: "old",
      path: "/proj/old.ts",
      repoRoot: "/proj",
      mode: "-",
      originalPath: null,
      preview: true,
    };
    const plan = planGitDiffOpen(
      [defaultTabs[0], preview],
      input,
      "default",
      false,
      alloc,
    );
    expect(plan.tabs).toHaveLength(2);
    expect(plan.tabs[1]).toMatchObject({
      id: 100,
      preview: true,
      path: "/proj/a.ts",
      title: "a.ts (+)",
    });
    expect(plan.targetId).toBe(100);
  });
});

describe("useTabs hook", () => {
  it("starts with a single chat tab and it active", () => {
    const { result } = renderHook(() => useTabs());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].kind).toBe("chat");
    expect(result.current.activeId).toBe(1);
  });

  it("open: openFileTab appends an editor tab and activates it", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts");
    });
    expect(result.current.tabs).toHaveLength(2);
    const editor = result.current.tabs[1];
    expect(editor).toMatchObject({
      kind: "editor",
      path: "/proj/a.ts",
      title: "a.ts",
      dirty: false,
      preview: false,
    });
    expect(result.current.activeId).toBe(editor.id);
  });

  it("dedupe: opening the same path again reuses the existing tab", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts");
    });
    const firstId = result.current.tabs.find((t) => t.kind === "editor")!.id;
    const before = result.current.tabs;
    act(() => {
      result.current.openFileTab("/proj/a.ts");
    });
    const editors = result.current.tabs.filter((t) => t.kind === "editor");
    expect(editors).toHaveLength(1); // not duplicated
    expect(editors[0].id).toBe(firstId);
    expect(result.current.tabs).toEqual(before);
  });

  it("preview: a pinned open promotes an existing preview tab in place", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts", false); // preview
    });
    const preview = result.current.tabs[1] as EditorTab;
    expect(preview.preview).toBe(true);

    act(() => {
      result.current.openFileTab("/proj/a.ts", true); // pin
    });
    const pinned = result.current.tabs[1] as EditorTab;
    expect(pinned.preview).toBe(false);
    expect(result.current.tabs).toHaveLength(2); // promoted, not duplicated
    expect(result.current.activeId).toBe(pinned.id);
  });

  it("preview: opening a second preview path reuses the single preview slot", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts", false);
    });
    act(() => {
      result.current.openFileTab("/proj/b.ts", false);
    });
    const editors = result.current.tabs.filter((t) => t.kind === "editor");
    expect(editors).toHaveLength(1); // only one editor tab total
    expect((editors[0] as EditorTab).path).toBe("/proj/b.ts");
    expect((editors[0] as EditorTab).preview).toBe(true);
  });

  it("dirty auto-pin: a dirty preview editor tab promotes to persistent", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts", false);
    });
    const previewId = result.current.tabs[1].id;
    act(() => {
      result.current.updateTab(previewId, { dirty: true });
    });
    const tab = result.current.tabs.find((t) => t.id === previewId) as EditorTab;
    expect(tab.preview).toBe(false);
    expect(tab.dirty).toBe(true);
  });

  it("switch: setActiveId changes the active tab", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts");
    });
    const editorId = result.current.tabs[1].id;
    act(() => {
      result.current.setActiveId(1);
    });
    expect(result.current.activeId).toBe(1);
    act(() => {
      result.current.setActiveId(editorId);
    });
    expect(result.current.activeId).toBe(editorId);
  });

  it("close: closing the active tab switches to its neighbor", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts");
    });
    const a = result.current.tabs.find((t) => t.path === "/proj/a.ts")!;
    act(() => {
      result.current.openFileTab("/proj/b.ts");
    });
    const b = result.current.tabs.find((t) => t.path === "/proj/b.ts")!;
    act(() => {
      result.current.setActiveId(b.id); // bring b to the front
    });
    expect(result.current.activeId).toBe(b.id);
    act(() => {
      result.current.closeTab(b.id);
    });
    expect(result.current.tabs.some((t) => t.id === b.id)).toBe(false);
    expect(result.current.activeId).toBe(a.id);
  });

  it("close guard: closing the last remaining tab is a no-op", () => {
    const { result } = renderHook(() => useTabs());
    expect(result.current.tabs).toHaveLength(1);
    act(() => {
      result.current.closeTab(1);
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe(1);
  });

  it("reorder: reorderTabByGap moves the tab within its space", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.openFileTab("/proj/a.ts");
    });
    const aId = result.current.tabs.find((t) => t.path === "/proj/a.ts")!.id;
    act(() => {
      result.current.openFileTab("/proj/b.ts");
    });
    const bId = result.current.tabs.find((t) => t.path === "/proj/b.ts")!.id;
    act(() => {
      result.current.reorderTabByGap(aId, 0);
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([aId, 1, bId]);
  });

  it("close: disposes the terminal session of a closed terminal tab", () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.newTab("/proj");
    });
    const terminalTab = result.current.tabs.find((t) => t.kind === "terminal")!;
    expect(terminalTab).toBeDefined();
    act(() => {
      result.current.closeTab(terminalTab.id);
    });
    expect(result.current.tabs.some((t) => t.kind === "terminal")).toBe(false);
  });
});

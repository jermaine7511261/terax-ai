import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import type { PaneNode } from "@/modules/terminal";
import {
  COMMAND_GROUPS,
  createCommandItems,
  type CommandPaletteActionContext,
} from "../commands";

const noop = () => {};

function baseCtx(over: Partial<CommandPaletteActionContext> = {}) {
  const ctx: CommandPaletteActionContext = {
    tabs: [],
    activeId: 0,
    searchTarget: null,
    explorerRoot: null,
    home: null,
    openFolder: noop,
    openNewTab: noop,
    openNewBlock: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openNewPreview: noop,
    openGitGraph: noop,
    toggleSourceControl: noop,
    closeActiveTabOrPane: noop,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    toggleAi: noop,
    askAiSelection: noop,
    openSettings: noop,
    openKeyboardShortcuts: noop,
    spaces: [],
    activeSpaceId: null,
    openSpacesOverview: noop,
    newSpace: noop,
    switchSpace: noop,
    ...over,
  };
  return ctx;
}

// A minimal terminal tab with a single-leaf pane tree.
function terminalTab(id: number): Tab {
  return {
    id,
    kind: "terminal",
    title: `Terminal ${id}`,
    paneTree: { kind: "leaf", id: 100 + id },
    activeLeafId: 100 + id,
    spaceId: "default",
  };
}

describe("COMMAND_GROUPS", () => {
  it("lists the stable command groups in order", () => {
    expect([...COMMAND_GROUPS]).toEqual([
      "General",
      "Spaces",
      "Tabs",
      "Panes",
      "Git",
      "Search",
      "View",
      "AI",
    ]);
  });
});

describe("createCommandItems", () => {
  it("includes the base general + workspace commands", () => {
    const items = createCommandItems(baseCtx());
    const ids = items.map((i) => i.id);
    expect(ids).toContain("settings.open");
    expect(ids).toContain("workspace.openFolder");
    expect(ids).toContain("theme.pick");
    expect(ids).toContain("shortcuts.open");
  });

  it("assigns items to the expected groups", () => {
    const items = createCommandItems(baseCtx());
    const groupOf = (id: string) => items.find((i) => i.id === id)?.group;
    expect(groupOf("settings.open")).toBe("General");
    expect(groupOf("spaces.overview")).toBe("Spaces");
    expect(groupOf("tab.new")).toBe("Tabs");
    expect(groupOf("pane.splitRight")).toBe("Panes");
    expect(groupOf("git.graph")).toBe("Git");
    expect(groupOf("search.content")).toBe("Search");
    expect(groupOf("sidebar.toggle")).toBe("View");
    expect(groupOf("ai.toggle")).toBe("AI");
  });

  it("maps each space to a switch command with current-space disabled", () => {
    const items = createCommandItems(
      baseCtx({
        spaces: [
          { id: "a", name: "Alpha" },
          { id: "b", name: "Beta" },
        ],
        activeSpaceId: "a",
      }),
    );
    const switchItems = items.filter((i) => i.id.startsWith("spaces.switch."));
    expect(switchItems).toHaveLength(2);
    expect(switchItems.map((i) => i.title)).toEqual([
      "Switch to Alpha",
      "Switch to Beta",
    ]);
    const alpha = items.find((i) => i.id === "spaces.switch.a");
    const beta = items.find((i) => i.id === "spaces.switch.b");
    expect(alpha?.disabledReason).toBe("Current space");
    expect(beta?.disabledReason).toBeUndefined();
  });

  it("invokes ctx.switchSpace when a switch command runs", () => {
    const switchSpace = (id: string) => captured.push(id);
    const captured: string[] = [];
    const items = createCommandItems(
      baseCtx({ spaces: [{ id: "a", name: "Alpha" }], switchSpace }),
    );
    const switchItem = items.find((i) => i.id === "spaces.switch.a");
    switchItem?.run();
    expect(captured).toEqual(["a"]);
  });

  it("disables editor/new tab when there is no workspace root", () => {
    const items = createCommandItems(
      baseCtx({ explorerRoot: null, home: null }),
    );
    const editor = items.find((i) => i.id === "tab.newEditor");
    expect(editor?.disabledReason).toBe("No workspace root");
  });

  it("enables the new editor tab when a workspace root exists", () => {
    const items = createCommandItems(baseCtx({ explorerRoot: "/root" }));
    const editor = items.find((i) => i.id === "tab.newEditor");
    expect(editor?.disabledReason).toBeUndefined();
  });

  it("disables split pane when no terminal tab is active", () => {
    const items = createCommandItems(baseCtx({ tabs: [], activeId: 0 }));
    for (const id of ["pane.splitRight", "pane.splitDown"]) {
      const item = items.find((i) => i.id === id);
      expect(item?.disabledReason).toBe("No terminal tab");
    }
  });

  it("disables split pane at the pane limit", () => {
    // A 5-leaf tree (MAX_PANES_PER_TAB === 5).
    const paneTree: PaneNode = {
      kind: "split",
      id: 1,
      dir: "col",
      children: [
        {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 101 },
            { kind: "leaf", id: 102 },
            { kind: "leaf", id: 103 },
          ],
        },
        {
          kind: "split",
          id: 3,
          dir: "row",
          children: [
            { kind: "leaf", id: 104 },
            { kind: "leaf", id: 105 },
          ],
        },
      ],
    };
    const items = createCommandItems(
      baseCtx({
        tabs: [
          {
            id: 1,
            kind: "terminal",
            title: "T",
            paneTree,
            activeLeafId: 101,
            spaceId: "default",
          },
        ],
        activeId: 1,
      }),
    );
    const right = items.find((i) => i.id === "pane.splitRight");
    const down = items.find((i) => i.id === "pane.splitDown");
    expect(right?.disabledReason).toBe("Pane limit");
    expect(down?.disabledReason).toBe("Pane limit");
  });

  it("enables split pane within the limit", () => {
    const items = createCommandItems(
      baseCtx({
        tabs: [terminalTab(1)],
        activeId: 1,
      }),
    );
    const right = items.find((i) => i.id === "pane.splitRight");
    expect(right?.disabledReason).toBeUndefined();
  });

  it("disables close when it is the last tab with a single pane", () => {
    const items = createCommandItems(
      baseCtx({
        tabs: [terminalTab(1)],
        activeId: 1,
      }),
    );
    const close = items.find((i) => i.id === "tab.close");
    expect(close?.disabledReason).toBe("Last tab");
  });

  it("enables close when there are multiple tabs", () => {
    const items = createCommandItems(
      baseCtx({
        tabs: [terminalTab(1), terminalTab(2)],
        activeId: 1,
      }),
    );
    const close = items.find((i) => i.id === "tab.close");
    expect(close?.disabledReason).toBeUndefined();
  });

  it("wires command action context functions to items", () => {
    const ctx = baseCtx();
    const items = createCommandItems(ctx);
    expect(items.find((i) => i.id === "settings.open")?.run).toBe(ctx.openSettings);
    expect(items.find((i) => i.id === "tab.new")?.run).toBe(ctx.openNewTab);
    expect(items.find((i) => i.id === "ai.toggle")?.run).toBe(ctx.toggleAi);
    expect(items.find((i) => i.id === "sidebar.toggle")?.run).toBe(
      ctx.toggleSidebar,
    );
  });

  it("sets search/find disabled reasons from context", () => {
    const noSearch = createCommandItems(
      baseCtx({ searchTarget: null, explorerRoot: null }),
    );
    expect(noSearch.find((i) => i.id === "search.focus")?.disabledReason).toBe(
      "No searchable view",
    );
    expect(
      noSearch.find((i) => i.id === "explorer.search")?.disabledReason,
    ).toBe("No workspace root");

    const withSearch = createCommandItems(
      baseCtx({
        searchTarget: { kind: "editor", handle: {} as never, focus: noop },
        explorerRoot: "/root",
      }),
    );
    expect(
      withSearch.find((i) => i.id === "search.focus")?.disabledReason,
    ).toBeUndefined();
    expect(
      withSearch.find((i) => i.id === "explorer.search")?.disabledReason,
    ).toBeUndefined();
  });
});

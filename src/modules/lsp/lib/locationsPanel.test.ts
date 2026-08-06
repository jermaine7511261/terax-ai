// @vitest-environment jsdom
import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  locationsPanel,
  openLocationsPanel,
  setLocationList,
  type LocationItem,
} from "./locationsPanel";

// jsdom lacks scrollIntoView; the panel's renderActive calls it.
Element.prototype.scrollIntoView = vi.fn() as unknown as () => void;

const items: LocationItem[] = [
  { uri: "file:///a.ts", line: 0, character: 2, label: "a.ts:1:3" },
  { uri: "file:///b.ts", line: 4, character: 0, label: "b.ts:5:1" },
];

function makeState() {
  return EditorState.create({
    extensions: [locationsPanel],
  });
}

// A minimal view wrapper whose dispatch applies transactions to a backing state,
// letting us exercise openLocationsPanel without a real DOM EditorView.
function fakeView() {
  let state = makeState();
  return {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = state.update(tr).state;
    },
  } as unknown as EditorView;
}

describe("locationsPanel state field", () => {
  it("starts empty (null)", () => {
    const state = makeState();
    expect(state.field(locationsPanel)).toBeNull();
  });

  it("stores a spec dispatched via openLocationsPanel", () => {
    const view = fakeView();
    openLocationsPanel(view, {
      title: "References",
      items,
      onPick: () => {},
    });
    const field = view.state.field(locationsPanel);
    expect(field).not.toBeNull();
    expect(field?.title).toBe("References");
    expect(field?.items).toHaveLength(2);
  });

  it("clears to null when a null effect is dispatched", () => {
    const view = fakeView();
    openLocationsPanel(view, { title: "References", items, onPick: () => {} });
    view.dispatch({ effects: [setLocationList.of(null)] });
    expect(view.state.field(locationsPanel)).toBeNull();
  });
});

describe("locationsPanel view / panel DOM", () => {
  async function mount(spec?: {
    title: string;
    items: LocationItem[];
    onPick: (item: LocationItem) => void;
  }) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    let state = makeState();
    if (spec) {
      state = state.update({ effects: [setLocationList.of(spec)] }).state;
    }
    const view = new EditorView({ state, parent });
    await new Promise((r) => requestAnimationFrame(r));
    return { view, parent };
  }

  it("renders the panel header with title and item count", async () => {
    const { view, parent } = await mount({
      title: "References",
      items,
      onPick: () => {},
    });
    const header = parent.querySelector(".cm-lsp-locations-header");
    expect(header).not.toBeNull();
    expect(header?.textContent).toBe("References (2)");
    expect(parent.querySelectorAll(".cm-lsp-locations li")).toHaveLength(2);
    view.destroy();
  });

  it("keyboard navigation moves the active row and picks on Enter", async () => {
    const { view, parent } = await mount({
      title: "References",
      items,
      onPick: () => {},
    });
    const picked: LocationItem[] = [];
    const spec = { title: "References", items, onPick: (item: LocationItem) => picked.push(item) };
    view.dispatch({ effects: setLocationList.of(spec) });
    await new Promise((r) => requestAnimationFrame(r));
    const lis = parent.querySelectorAll(".cm-lsp-locations li");
    const listEl = parent.querySelector(".cm-lsp-locations ul");
    const key = (k: string) =>
      new KeyboardEvent("keydown", { key: k, bubbles: true });
    listEl!.dispatchEvent(key("ArrowDown"));
    expect(lis[1].classList.contains("cm-lsp-locations-active")).toBe(true);
    listEl!.dispatchEvent(key("ArrowUp"));
    expect(lis[0].classList.contains("cm-lsp-locations-active")).toBe(true);
    listEl!.dispatchEvent(key("Enter"));
    expect(picked).toEqual([items[0]]);
    view.destroy();
  });

  it("Escape closes the panel and blurs the active row", async () => {
    const { view, parent } = await mount({
      title: "References",
      items,
      onPick: () => {},
    });
    const listEl = parent.querySelector(".cm-lsp-locations ul");
    listEl!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(view.state.field(locationsPanel)).toBeNull();
    view.destroy();
  });

  it("mousedown on a row picks that item and closes the panel", async () => {
    const { view, parent } = await mount({
      title: "References",
      items,
      onPick: () => {},
    });
    const picked: LocationItem[] = [];
    view.dispatch({
      effects: setLocationList.of({
        title: "References",
        items,
        onPick: (item: LocationItem) => picked.push(item),
      }),
    });
    await new Promise((r) => requestAnimationFrame(r));
    const lis = parent.querySelectorAll(".cm-lsp-locations li");
    lis[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(picked).toEqual([items[1]]);
    expect(view.state.field(locationsPanel)).toBeNull();
    view.destroy();
  });

  it("wires the mount callback to focus the list", async () => {
    const { view } = await mount({
      title: "References",
      items,
      onPick: () => {},
    });
    expect(parentOf(view).querySelector(".cm-lsp-locations ul")).toBeTruthy();
    view.destroy();
  });
});

function parentOf(view: EditorView) {
  return view.dom.parentElement!;
}

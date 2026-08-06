// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { historyOpen, historyPopover } from "./historyPopover";

// jsdom lacks scrollIntoView; stub it so the popover render doesn't crash.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const fetchMock = vi.fn();

function press(view: EditorView, init: KeyboardEventInit) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, ...init }),
  );
}

function makeView(doc = "git", selection = 0) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions: [...historyPopover(fetchMock)],
    }),
    parent,
  });
  return view;
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("historyOpen", () => {
  it("is false by default", () => {
    const view = makeView();
    expect(historyOpen(view.state)).toBe(false);
  });
});

describe("historyPopover key handling", () => {
  it("ArrowUp on the first line opens the popover with fetched items", async () => {
    fetchMock.mockResolvedValue(["git status", "git log"]);
    const view = makeView("git");
    view.focus();
    press(view, { key: "ArrowUp" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith("git", 200);
    expect(historyOpen(view.state)).toBe(true);
    view.destroy();
  });

  it("does not open when the fetch returns no items", async () => {
    fetchMock.mockResolvedValue([]);
    const view = makeView("git");
    view.focus();
    press(view, { key: "ArrowUp" });
    await new Promise((r) => setTimeout(r, 0));
    expect(historyOpen(view.state)).toBe(false);
    view.destroy();
  });

  it("Enter accepts the selected command and closes the popover", async () => {
    fetchMock.mockResolvedValue(["git status", "git log"]);
    const view = makeView("git");
    view.focus();
    press(view, { key: "ArrowUp" });
    await new Promise((r) => setTimeout(r, 0));
    expect(historyOpen(view.state)).toBe(true);
    press(view, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("git status");
    expect(historyOpen(view.state)).toBe(false);
    view.destroy();
  });

  it("Escape dismisses an open popover", async () => {
    fetchMock.mockResolvedValue(["git status"]);
    const view = makeView("git");
    view.focus();
    press(view, { key: "ArrowUp" });
    await new Promise((r) => setTimeout(r, 0));
    expect(historyOpen(view.state)).toBe(true);
    press(view, { key: "Escape" });
    expect(historyOpen(view.state)).toBe(false);
    view.destroy();
  });

  it("ArrowDown on a closed popover is a no-op", () => {
    const view = makeView("git");
    view.focus();
    press(view, { key: "ArrowDown" });
    expect(historyOpen(view.state)).toBe(false);
    expect(view.state.doc.toString()).toBe("git");
    view.destroy();
  });

  it("ArrowUp on a multi-line doc does not open the popover", async () => {
    fetchMock.mockResolvedValue(["x"]);
    const view = makeView("line1\nline2", 8);
    view.focus();
    press(view, { key: "ArrowUp" });
    await new Promise((r) => setTimeout(r, 0));
    expect(historyOpen(view.state)).toBe(false);
    view.destroy();
  });
});

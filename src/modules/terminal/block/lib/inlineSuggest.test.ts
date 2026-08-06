// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptInlineSuggestion, inlineSuggestion } from "./inlineSuggest";

function makeView(
  doc: string,
  fetch: (line: string) => Promise<string | null>,
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    extensions: [inlineSuggestion(fetch)],
  });
  return { view: new EditorView({ state, parent }), parent };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("inlineSuggestion", () => {
  it("renders a ghost suggestion after the fetch resolves", async () => {
    const { view, parent } = makeView("foo", async (line) =>
      line === "foo" ? "foobar" : null,
    );
    // Trigger a doc change so the fetcher schedules its 70ms timer.
    view.dispatch({ changes: { from: 0, to: 3, insert: "" } });
    view.dispatch({ changes: { from: 0, insert: "foo" }, selection: { anchor: 3 } });
    await vi.advanceTimersByTimeAsync(70);
    // Ghost widget shows the tail after the cursor: "bar".
    expect(parent.textContent).toContain("bar");
    view.destroy();
    parent.remove();
  });

  it("does not render a ghost when fetch returns null", async () => {
    const { view, parent } = makeView("foo", async () => null);
    view.dispatch({ changes: { from: 0, to: 3, insert: "" } });
    view.dispatch({ changes: { from: 0, insert: "foo" }, selection: { anchor: 3 } });
    await vi.advanceTimersByTimeAsync(70);
    expect(parent.textContent).not.toContain("bar");
    expect(parent.querySelector(".cm-ghost")).toBeNull();
    view.destroy();
    parent.remove();
  });

  it("clears the suggestion when the document diverges from it", async () => {
    const { view, parent } = makeView("foo", async (line) =>
      line === "foo" ? "foobar" : null,
    );
    view.dispatch({ changes: { from: 0, to: 3, insert: "" } });
    view.dispatch({ changes: { from: 0, insert: "foo" }, selection: { anchor: 3 } });
    await vi.advanceTimersByTimeAsync(70);
    expect(parent.textContent).toContain("bar");
    // User edits diverge from the suggestion -> ghost disappears.
    view.dispatch({ changes: { from: 3, insert: "!" } });
    expect(parent.querySelector(".cm-ghost")).toBeNull();
    view.destroy();
    parent.remove();
  });
});

describe("acceptInlineSuggestion", () => {
  it("returns false when there is no suggestion", () => {
    const { view, parent } = makeView("foo", async () => null);
    expect(acceptInlineSuggestion(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("foo");
    view.destroy();
    parent.remove();
  });

  it("appends the suggestion tail to the document", async () => {
    const { view, parent } = makeView("foo", async (line) =>
      line === "foo" ? "foobar" : null,
    );
    view.dispatch({ changes: { from: 0, to: 3, insert: "" } });
    view.dispatch({ changes: { from: 0, insert: "foo" }, selection: { anchor: 3 } });
    await vi.advanceTimersByTimeAsync(70);
    expect(acceptInlineSuggestion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("foobar");
    // Accepting clears the suggestion -> subsequent accept is a no-op.
    expect(acceptInlineSuggestion(view)).toBe(false);
    view.destroy();
    parent.remove();
  });
});

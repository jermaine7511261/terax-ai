// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { applyHex, colorSwatches, isHex, toHex6 } from "./colorSwatches";

describe("colorSwatches pure helpers", () => {
  it("isHex: hex vs functional colors", () => {
    expect(isHex("#ff0000")).toBe(true);
    expect(isHex("#abc")).toBe(true);
    expect(isHex("rgb(1,2,3)")).toBe(false);
    expect(isHex("hsla(1,2%,3%,0.5)")).toBe(false);
  });

  it("toHex6: expands 3-digit and 4-digit hex", () => {
    expect(toHex6("#abc")).toBe("#aabbcc");
    expect(toHex6("#abcd")).toBe("#aabbcc");
    expect(toHex6("#aabbcc")).toBe("#aabbcc");
    expect(toHex6("#aabbccdd")).toBe("#aabbcc");
    expect(toHex6("#ff0000")).toBe("#ff0000");
  });

  it("applyHex: preserves alpha for 8-digit originals", () => {
    expect(applyHex("#11223344", "#aabbcc")).toBe("#aabbcc44");
  });

  it("applyHex: expands alpha for 4-digit originals", () => {
    expect(applyHex("#123f", "#aabbcc")).toBe("#aabbccff");
  });

  it("applyHex: replaces fully for 6-digit originals", () => {
    expect(applyHex("#112233", "#aabbcc")).toBe("#aabbcc");
  });

  it("applyHex: replaces fully for 3-digit originals", () => {
    expect(applyHex("#123", "#aabbcc")).toBe("#aabbcc");
  });
});

describe("colorSwatches extension", () => {
  it("builds swatch decorations for hex colors and inputs for editable hex", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: "color #ff0000 and #abc and rgb(1,2,3)",
      extensions: [colorSwatches()],
    });
    const view = new EditorView({ state, parent });

    // 2 hex swatches (editable -> input) + 1 functional (not editable, no input).
    const swatches = parent.querySelectorAll(".cm-color-swatch");
    expect(swatches.length).toBe(3);
    const inputs = parent.querySelectorAll("input.cm-color-swatch-input");
    expect(inputs.length).toBe(2);
    // First swatch input value is the expanded 6-digit hex.
    expect((inputs[0] as HTMLInputElement).value).toBe("#ff0000");
    expect((inputs[1] as HTMLInputElement).value).toBe("#aabbcc");

    view.destroy();
    parent.remove();
  });

  it("renders a single swatch for a bare hex in a line", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: "#112233",
      extensions: [colorSwatches()],
    });
    const view = new EditorView({ state, parent });
    expect(parent.querySelectorAll(".cm-color-swatch").length).toBe(1);
    view.destroy();
    parent.remove();
  });
});

// biome-ignore-all lint/style/noNonNullAssertion: 测试断言数据必然存在
// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import type { LanguageDefinition } from "./languageDefinitions";

const langFixture = vi.hoisted(() => {
  const fixture: LanguageDefinition[] = [
    {
      name: "TypeScript",
      extensions: ["ts", "mts"],
      loader: () =>
        import("@codemirror/lang-javascript").then((m) => m.javascript()),
    },
    {
      name: "Markdown",
      extensions: ["md"],
      loader: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
    },
    {
      name: "YaMet Theme",
      extensions: ["ytheme"],
      loader: () => Promise.resolve({} as never),
    },
  ];
  return fixture;
});

vi.mock("./languageDefinitions", () => ({
  LANGUAGES: langFixture,
}));

vi.mock("@/platform", () => ({ openUrl: vi.fn() }));

import { markdownCodeLanguages, urlAt } from "./markdownExtras";

function viewFor(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent });
}

describe("markdownCodeLanguages", () => {
  it("excludes Markdown and YaMet Theme from fence languages", () => {
    const langs = markdownCodeLanguages();
    const names = langs.map((l) => l.name);
    expect(names).toContain("TypeScript");
    expect(names).not.toContain("Markdown");
    expect(names).not.toContain("YaMet Theme");
  });

  it("resolves a language support via its loader", async () => {
    const langs = markdownCodeLanguages();
    const ts = langs.find((l) => l.name === "TypeScript")!;
    const support = await ts.load();
    // javascript() returns a LanguageSupport instance.
    expect(support.constructor.name).toBe("LanguageSupport");
  });

  it("is memoized across calls", () => {
    expect(markdownCodeLanguages()).toBe(markdownCodeLanguages());
  });
});

describe("urlAt", () => {
  it("finds a URL that contains the position", () => {
    const view = viewFor("visit https://example.com/a now");
    // https://example.com/a starts at index 6, length 21 -> pos 6+10 inside.
    expect(urlAt(view, 16)).toBe("https://example.com/a");
    view.destroy();
  });

  it("returns null when position is not inside a URL", () => {
    const view = viewFor("visit https://example.com/a now");
    expect(urlAt(view, 0)).toBeNull();
    expect(urlAt(view, 30)).toBeNull();
    view.destroy();
  });

  it("returns null when there is no URL on the line", () => {
    const view = viewFor("plain text with no link");
    expect(urlAt(view, 5)).toBeNull();
    view.destroy();
  });
});

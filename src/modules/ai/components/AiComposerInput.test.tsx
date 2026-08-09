import { describe, expect, it } from "vitest";
import { detectFileTrigger, detectSnippetTrigger } from "./AiComposerInput";

describe("detectSnippetTrigger", () => {
  it("triggers on a leading slash", () => {
    const t = detectSnippetTrigger("/", 1);
    expect(t).not.toBeNull();
    expect(t?.char).toBe("/");
    expect(t?.query).toBe("");
  });

  it("triggers on a leading hash", () => {
    const t = detectSnippetTrigger("#", 1);
    expect(t).not.toBeNull();
    expect(t?.char).toBe("#");
  });

  it("collects the typed query after the trigger char", () => {
    const t = detectSnippetTrigger("/revi", 5);
    expect(t?.char).toBe("/");
    expect(t?.query).toBe("revi");
  });

  it("triggers after a space in mid-sentence", () => {
    const t = detectSnippetTrigger("fix this /plan", 14);
    expect(t?.char).toBe("/");
    expect(t?.query).toBe("plan");
  });

  it("does not trigger when the char is mid-word", () => {
    expect(detectSnippetTrigger("a/plan", 6)).toBeNull();
  });

  it("does not trigger on a bare char without word boundary", () => {
    // caret directly after text with no preceding whitespace
    expect(detectSnippetTrigger("foo", 3)).toBeNull();
  });
});

describe("detectFileTrigger", () => {
  it("triggers on a leading @", () => {
    const t = detectFileTrigger("@", 1);
    expect(t).not.toBeNull();
    expect(t?.query).toBe("");
  });

  it("collects the path query", () => {
    const t = detectFileTrigger("@src/", 5);
    expect(t?.query).toBe("src/");
  });

  it("triggers after whitespace", () => {
    const t = detectFileTrigger("look at @src/main.ts", 20);
    expect(t?.query).toBe("src/main.ts");
  });

  it("does not trigger mid-word", () => {
    expect(detectFileTrigger("me@example.com", 13)).toBeNull();
  });
});

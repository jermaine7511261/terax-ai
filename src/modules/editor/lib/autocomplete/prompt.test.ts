import { describe, expect, it } from "vitest";
import { buildUserPrompt, trimContext } from "./prompt";

describe("trimContext", () => {
  it("leaves short prefix and suffix unchanged", () => {
    expect(trimContext("abc", "xyz")).toEqual({ prefix: "abc", suffix: "xyz" });
  });

  it("keeps the tail of an over-long prefix (nearest the cursor)", () => {
    const prefix = `${"x".repeat(5000)}TAIL`;
    const { prefix: out } = trimContext(prefix, "");
    expect(out).toHaveLength(4000);
    expect(out.endsWith("TAIL")).toBe(true);
  });

  it("keeps the head of an over-long suffix (nearest the cursor)", () => {
    const suffix = `HEAD${"y".repeat(5000)}`;
    const { suffix: out } = trimContext("", suffix);
    expect(out).toHaveLength(2000);
    expect(out.startsWith("HEAD")).toBe(true);
  });
});

describe("buildUserPrompt", () => {
  it("wraps prefix and suffix in fenced blocks", () => {
    const prompt = buildUserPrompt({
      prefix: "foo",
      suffix: "bar",
      filename: null,
      language: null,
      indentUnit: null,
    });
    expect(prompt).toContain("PREFIX:\n<<<\nfoo\n>>>");
    expect(prompt).toContain("SUFFIX:\n<<<\nbar\n>>>");
  });

  it("omits the metadata block when no metadata is provided", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: null,
      language: null,
      indentUnit: null,
    });
    expect(prompt.startsWith("PREFIX:")).toBe(true);
  });

  it("includes file, language, and space-indent metadata", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: "a.ts",
      language: "typescript",
      indentUnit: "  ",
    });
    expect(prompt).toContain("File: a.ts");
    expect(prompt).toContain("Language: typescript");
    expect(prompt).toContain("Indent: 2 spaces");
  });

  it("labels a tab indent unit as tabs", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: null,
      language: null,
      indentUnit: "\t",
    });
    expect(prompt).toContain("Indent: tabs");
  });

  it("injects project context (notes + siblings) before PREFIX", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: "/repo/src/a.ts",
      language: "typescript",
      indentUnit: null,
      projectContext: {
        dir: "/repo",
        notes: "Use camelCase for locals. Never use any.",
        siblingSnippets: [{ filename: "b.ts", head: "export const X = 1;" }],
      },
    });
    expect(prompt).toContain("Project notes (/repo)");
    expect(prompt).toContain("Use camelCase for locals");
    expect(prompt).toContain("--- b.ts ---");
    expect(prompt).toContain("export const X = 1;");
    expect(prompt.indexOf("CONTEXT")).toBeLessThan(prompt.indexOf("PREFIX:"));
  });

  it("omits the context block when project context is empty", () => {
    const prompt = buildUserPrompt({
      prefix: "x",
      suffix: "y",
      filename: "a.ts",
      language: null,
      indentUnit: null,
      projectContext: { dir: "/r", notes: "", siblingSnippets: [] },
    });
    expect(prompt).not.toContain("CONTEXT");
    expect(prompt.startsWith("File: a.ts")).toBe(true);
  });

  it("truncates the embedded context to the trim limits", () => {
    const prompt = buildUserPrompt({
      prefix: "p".repeat(5000),
      suffix: "s".repeat(5000),
      filename: null,
      language: null,
      indentUnit: null,
    });
    expect(prompt).toContain("p".repeat(4000));
    expect(prompt).not.toContain("p".repeat(4001));
    expect(prompt).toContain("s".repeat(2000));
    expect(prompt).not.toContain("s".repeat(2001));
  });
});

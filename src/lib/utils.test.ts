import { describe, expect, it } from "vitest";
import { isMarkdownPath, isPreviewableFilePath } from "./utils";

describe("isMarkdownPath", () => {
  it("matches markdown extensions case-insensitively", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
    expect(isMarkdownPath("doc.mdx")).toBe(true);
    expect(isMarkdownPath("a/b/c.Md")).toBe(true);
  });

  it("only matches the extension at the end of the path", () => {
    expect(isMarkdownPath("file.md.txt")).toBe(false);
    expect(isMarkdownPath("x.mdxx")).toBe(false);
  });

  it("rejects non-markdown or extensionless paths", () => {
    expect(isMarkdownPath("file.txt")).toBe(false);
    expect(isMarkdownPath("mdfile")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
  });
});

describe("isPreviewableFilePath", () => {
  it("rejects markdown files", () => {
    expect(isPreviewableFilePath("README.md")).toBe(false);
  });

  it("matches image files", () => {
    expect(isPreviewableFilePath("photo.png")).toBe(true);
    expect(isPreviewableFilePath("icon.svg")).toBe(true);
    expect(isPreviewableFilePath("banner.jpg")).toBe(true);
  });

  it("matches PDF files", () => {
    expect(isPreviewableFilePath("doc.pdf")).toBe(true);
  });

  it("rejects HTML files", () => {
    expect(isPreviewableFilePath("page.html")).toBe(false);
  });

  it("rejects non-previewable files", () => {
    expect(isPreviewableFilePath("script.ts")).toBe(false);
    expect(isPreviewableFilePath("data.json")).toBe(false);
  });
});

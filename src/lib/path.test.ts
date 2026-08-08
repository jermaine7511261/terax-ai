import { describe, expect, it } from "vitest";
import { basename, dirname } from "./path";

describe("basename", () => {
  it("handles forward slashes", () => {
    expect(basename("a/b/c.ts")).toBe("c.ts");
    expect(basename("/a/b/")).toBe("b");
    expect(basename("a")).toBe("a");
  });

  it("handles backslashes (Windows / OSC 7 paths)", () => {
    expect(basename("a\\b\\c.ts")).toBe("c.ts");
    expect(basename("C:\\Users\\Admin")).toBe("Admin");
    expect(basename("\\\\server\\share\\dir")).toBe("dir");
  });

  it("handles mixed separators and edge inputs", () => {
    expect(basename("a/b\\c")).toBe("c");
    expect(basename("C:/")).toBe("C:");
    expect(basename("")).toBe("");
  });
});

describe("dirname", () => {
  it("returns the directory portion without a trailing slash", () => {
    expect(dirname("a/b")).toBe("a");
    expect(dirname("/a/b/c")).toBe("/a/b");
    expect(dirname("a/b/")).toBe("a/b");
  });

  it("handles backslashes and mixed separators", () => {
    expect(dirname("a\\b\\c")).toBe("a\\b");
    expect(dirname("a/b\\c")).toBe("a/b");
    expect(dirname("C:\\dir\\file.txt")).toBe("C:\\dir");
  });

  it("returns empty for bare names and single separators", () => {
    expect(dirname("a")).toBe("");
    expect(dirname("/a")).toBe("");
    expect(dirname("")).toBe("");
  });
});

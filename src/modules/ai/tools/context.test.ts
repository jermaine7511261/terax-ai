import { describe, expect, it, vi } from "vitest";
import { resolvePath } from "./context";

// The module resolves `cachedHome` from homeDir() at import time. Mock it to a
// known value so `~` expansion branches are deterministic. The "home not
// available" case is exercised in a separate test via vi.resetModules().
vi.mock("@/platform", () => ({
  homeDir: () => Promise.resolve("/home/user"),
}));

describe("resolvePath", () => {
  describe("absolute paths pass through", () => {
    it("returns POSIX absolute paths unchanged", () => {
      expect(resolvePath("/etc/hosts", "/cwd")).toBe("/etc/hosts");
      expect(resolvePath("/", "/cwd")).toBe("/");
    });

    it("returns Windows drive-absolute paths unchanged", () => {
      expect(resolvePath("C:/Users/x/file.txt", "/cwd")).toBe("C:/Users/x/file.txt");
      expect(resolvePath("C:\\Users\\x\\file.txt", "/cwd")).toBe("C:\\Users\\x\\file.txt");
      expect(resolvePath("c:\\foo\\bar", null)).toBe("c:\\foo\\bar");
    });
  });

  describe("~ expansion", () => {
    it("expands a bare ~ to the home directory", () => {
      expect(resolvePath("~", "/cwd")).toBe("/home/user");
    });

    it("expands ~/sub to home/sub", () => {
      expect(resolvePath("~/docs", "/cwd")).toBe("/home/user/docs");
      expect(resolvePath("~/a/b", "/cwd")).toBe("/home/user/a/b");
    });

    it("expands ~user to the parent dir of home joined with the user", () => {
      expect(resolvePath("~alice", "/cwd")).toBe("/home/alice");
    });

    it("expands ~user/sub to the user's home subpath", () => {
      expect(resolvePath("~alice/proj", "/cwd")).toBe("/home/alice/proj");
    });

    it("resolves ~ without needing a cwd (null cwd fallback)", () => {
      expect(resolvePath("~/docs", null)).toBe("/home/user/docs");
      expect(resolvePath("~", null)).toBe("/home/user");
    });

    it("throws when the home directory is not available yet", async () => {
      vi.resetModules();
      vi.doMock("@/platform", () => ({
        homeDir: () => Promise.reject(new Error("no home")),
      }));
      const mod = await import("./context");
      expect(() => mod.resolvePath("~/docs", "/cwd")).toThrow(/home directory not available/);
    });
  });

  describe("relative paths", () => {
    it("joins a relative path to a POSIX cwd with a slash", () => {
      expect(resolvePath("src/foo.ts", "/project")).toBe("/project/src/foo.ts");
    });

    it("joins a relative path to a cwd ending in a slash without doubling it", () => {
      expect(resolvePath("src/foo.ts", "/project/")).toBe("/project/src/foo.ts");
    });

    it("joins a relative path to a Windows cwd with a backslash", () => {
      expect(resolvePath("src\\foo.ts", "C:\\project")).toBe("C:\\project\\src\\foo.ts");
      expect(resolvePath("src\\foo.ts", "C:\\project\\")).toBe("C:\\project\\src\\foo.ts");
    });

    it("uses a forward slash for a mixed-separator cwd", () => {
      expect(resolvePath("foo.ts", "C:\\project/sub")).toBe("C:\\project/sub/foo.ts");
    });

    it("returns the cwd + separator for an empty raw path", () => {
      expect(resolvePath("", "/project")).toBe("/project/");
      expect(resolvePath("", "C:\\project")).toBe("C:\\project\\");
    });

    it("passes dot segments through without normalization", () => {
      expect(resolvePath("a/./b/../c", "/project")).toBe("/project/a/./b/../c");
    });

    it("throws when there is no cwd for a relative path", () => {
      expect(() => resolvePath("src/foo.ts", null)).toThrow(/no active terminal cwd/);
    });
  });
});

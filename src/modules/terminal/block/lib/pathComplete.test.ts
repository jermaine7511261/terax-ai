import { describe, expect, it } from "vitest";

import { resolveDir } from "./pathComplete";

const HOME = "C:/Users/Admin";

describe("pathComplete.resolveDir", () => {
  it("resolves ~ to the home dir", () => {
    expect(resolveDir("~/", "/repo", HOME)).toBe("C:/Users/Admin");
  });

  it("resolves ~/sub/ under the home dir", () => {
    expect(resolveDir("~/code/", "/repo", HOME)).toBe(
      "C:/Users/Admin/code",
    );
  });

  it("resolves ~user to a sibling of the home dir", () => {
    expect(resolveDir("~bob/", "/repo", HOME)).toBe("C:/Users/bob");
    expect(resolveDir("~bob/proj/", "/repo", HOME)).toBe(
      "C:/Users/bob/proj",
    );
  });

  it("resolves relative paths against cwd", () => {
    expect(resolveDir("src/", "/repo", HOME)).toBe("/repo/src");
    expect(resolveDir("", "/repo", HOME)).toBe("/repo");
  });

  it("keeps absolute paths untouched", () => {
    expect(resolveDir("/etc/", "/repo", HOME)).toBe("/etc/");
  });

  it("returns null for ~ when no home is known", () => {
    expect(resolveDir("~/", "/repo", "")).toBeNull();
  });
});

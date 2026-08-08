import { describe, expect, it } from "vitest";
import { webPath } from "./path";

describe("webPath.join", () => {
  it("joins simple segments", async () => {
    expect(await webPath.join("a", "b", "c")).toBe("a/b/c");
  });

  it("returns / for empty input", async () => {
    expect(await webPath.join()).toBe("/");
    expect(await webPath.join("", "", "")).toBe("/");
  });

  it("strips leading/trailing slashes on non-first segments", async () => {
    expect(await webPath.join("a", "/b/", "c")).toBe("a/b/c");
  });

  it("strips trailing slash on first segment", async () => {
    expect(await webPath.join("a/", "b")).toBe("a/b");
  });

  it("drops '.' segments", async () => {
    expect(await webPath.join("a", ".", "b")).toBe("a/b");
  });

  it("drops empty segments", async () => {
    expect(await webPath.join("a", "", "b")).toBe("a/b");
  });

  it("handles a single segment", async () => {
    expect(await webPath.join("only")).toBe("only");
  });

  it("preserves absolute first segment", async () => {
    expect(await webPath.join("/usr", "bin")).toBe("/usr/bin");
  });
});

describe("webPath.homeDir / appConfigDir", () => {
  it("homeDir is /", async () => {
    expect(await webPath.homeDir()).toBe("/");
  });

  it("appConfigDir is / .config/yamet", async () => {
    expect(await webPath.appConfigDir()).toBe("/.config/yamet");
  });
});

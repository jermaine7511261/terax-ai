import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  consumeLaunchFiles,
  getLaunchDir,
  initLaunchDir,
} from "./launchDir";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("initLaunchDir", () => {
  it("uses get_launch_dir and normalizes backslashes", async () => {
    invokeMock.mockResolvedValueOnce("C:\\Users\\me\\proj");
    await initLaunchDir();
    expect(getLaunchDir()).toBe("C:/Users/me/proj");
  });

  it("falls back to workspace_current_dir when get_launch_dir is null", async () => {
    invokeMock.mockResolvedValueOnce(null);
    invokeMock.mockResolvedValueOnce("/ws");
    await initLaunchDir();
    expect(getLaunchDir()).toBe("/ws");
  });

  it("falls back to workspace_current_dir when get_launch_dir rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    invokeMock.mockResolvedValueOnce("/home/u");
    await initLaunchDir();
    expect(getLaunchDir()).toBe("/home/u");
  });

  it("leaves the cache undefined when every source fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("a"));
    invokeMock.mockRejectedValueOnce(new Error("b"));
    await initLaunchDir();
    expect(getLaunchDir()).toBeUndefined();
  });
});

describe("getLaunchDir", () => {
  it("returns undefined before init runs", () => {
    expect(getLaunchDir()).toBeUndefined();
  });
});

describe("consumeLaunchFiles", () => {
  it("normalizes file paths and drains launch files", async () => {
    invokeMock.mockResolvedValueOnce([
      "C:\\ws\\a.ts",
      "C:\\ws\\b.ts",
    ]);
    await expect(consumeLaunchFiles()).resolves.toEqual([
      "C:/ws/a.ts",
      "C:/ws/b.ts",
    ]);
  });

  it("returns an empty list when invoke fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no files"));
    await expect(consumeLaunchFiles()).resolves.toEqual([]);
  });
});

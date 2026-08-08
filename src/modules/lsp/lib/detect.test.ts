import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { useLspRuntimeStore } from "./runtimeStore";
import { detectBinary, redetectBinary } from "./detect";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
  useLspRuntimeStore.setState({ detected: {} });
});

describe("detectBinary", () => {
  it("returns the cached path without invoking", async () => {
    useLspRuntimeStore.setState({ detected: { clangd: "/usr/bin/clangd" } });
    await expect(detectBinary("clangd")).resolves.toBe("/usr/bin/clangd");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("invokes lsp_detect and caches the result", async () => {
    mockInvoke.mockResolvedValue("/bin/rust-analyzer");
    await expect(detectBinary("rust-analyzer")).resolves.toBe(
      "/bin/rust-analyzer",
    );
    expect(mockInvoke).toHaveBeenCalledWith("lsp_detect", {
      command: "rust-analyzer",
    });
    expect(useLspRuntimeStore.getState().detected["rust-analyzer"]).toBe(
      "/bin/rust-analyzer",
    );
  });

  it("caches a null miss too", async () => {
    mockInvoke.mockResolvedValue(null);
    await detectBinary("nope");
    expect(useLspRuntimeStore.getState().detected.nope).toBeNull();
  });

  it("coalesces concurrent calls into a single invoke", async () => {
    let calls = 0;
    mockInvoke.mockImplementation(async () => {
      calls++;
      return "/x";
    });
    const [a, b] = await Promise.all([
      detectBinary("gopls"),
      detectBinary("gopls"),
    ]);
    expect(a).toBe("/x");
    expect(b).toBe("/x");
    expect(calls).toBe(1);
  });

  it("falls back to null when invoke rejects", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    await expect(detectBinary("missing")).resolves.toBeNull();
    expect(useLspRuntimeStore.getState().detected.missing).toBeNull();
  });
});

describe("redetectBinary", () => {
  it("clears the cache entry and re-invokes", async () => {
    useLspRuntimeStore.setState({ detected: { clangd: "/old" } });
    mockInvoke.mockResolvedValue("/new");
    await expect(redetectBinary("clangd")).resolves.toBe("/new");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(useLspRuntimeStore.getState().detected.clangd).toBe("/new");
  });
});

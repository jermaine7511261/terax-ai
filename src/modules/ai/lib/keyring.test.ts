import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config")>();
  return {
    ...actual,
    providerSupportsKey: (id: string) => id !== "llama.cpp",
  };
});

import {
  clearKey,
  EMPTY_PROVIDER_KEYS,
  getAllKeys,
  getKey,
  hasAnyKey,
  setKey,
  setCustomEndpointKey,
  getCustomEndpointKey,
} from "./keyring";

describe("keyring getKey/setKey/clearKey", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("returns null for providers that do not support keys", async () => {
    expect(await getKey("llama.cpp")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns null when no key stored", async () => {
    invoke.mockResolvedValue(null);
    expect(await getKey("openrouter")).toBeNull();
  });

  it("returns null for empty stored key", async () => {
    invoke.mockResolvedValue("");
    expect(await getKey("openrouter")).toBeNull();
  });

  it("returns the stored key", async () => {
    invoke.mockResolvedValue("sk-123");
    expect(await getKey("openrouter")).toBe("sk-123");
  });

  it("returns null when invoke rejects", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    expect(await getKey("openrouter")).toBeNull();
  });

  it("setKey throws for empty key", async () => {
    await expect(setKey("openrouter", "   ")).rejects.toThrow("empty");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("setKey throws for providers without key support", async () => {
    await expect(setKey("llama.cpp", "x")).rejects.toThrow("API key");
  });

  it("setKey trims and invokes secrets_set", async () => {
    invoke.mockResolvedValue(undefined);
    await setKey("openrouter", "  sk-xyz  ");
    expect(invoke).toHaveBeenCalledWith("secrets_set", expect.objectContaining({
      password: "sk-xyz",
    }));
  });

  it("clearKey is a no-op for unsupported providers", async () => {
    await clearKey("llama.cpp");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("keyring hasAnyKey / getAllKeys", () => {
  it("hasAnyKey returns false when no keys set", () => {
    expect(hasAnyKey({ ...EMPTY_PROVIDER_KEYS })).toBe(false);
  });

  it("hasAnyKey returns true when a key is present", () => {
    expect(hasAnyKey({ ...EMPTY_PROVIDER_KEYS, openrouter: "sk-1" })).toBe(true);
  });

  it("getAllKeys falls back to per-key lookups on batch failure", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "secrets_get_all") return Promise.reject(new Error("fail"));
      if (cmd === "secrets_get") return Promise.resolve("sk-fallback");
      return Promise.resolve(null);
    });
    const keys = await getAllKeys();
    expect(keys.openrouter).toBe("sk-fallback");
  });
});

describe("keyring custom endpoints", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("setCustomEndpointKey rejects empty", async () => {
    await expect(setCustomEndpointKey("e1", "")).rejects.toThrow("empty");
  });

  it("getCustomEndpointKey returns null on invoke failure", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    expect(await getCustomEndpointKey("e1")).toBeNull();
  });

  it("getCustomEndpointKey returns stored key", async () => {
    invoke.mockResolvedValue("sk-ep");
    expect(await getCustomEndpointKey("e1")).toBe("sk-ep");
  });
});

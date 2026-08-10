import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({
  native: {
    resilienceAvailable: vi.fn(),
    resilienceRecordSuccess: vi.fn(),
    resilienceRecordFailure: vi.fn(),
  },
}));
vi.mock("./agent", () => ({
  buildConfiguredLanguageModel: vi.fn(),
}));

import { native } from "./native";
import { buildConfiguredLanguageModel } from "./agent";
import {
  generateTextWithFallback,
  isRetryableModelError,
} from "./resilience";

const mockAvailable = vi.mocked(native.resilienceAvailable);
const mockRecordSuccess = vi.mocked(native.resilienceRecordSuccess);
const mockRecordFailure = vi.mocked(native.resilienceRecordFailure);
const mockBuild = vi.mocked(buildConfiguredLanguageModel);

beforeEach(() => {
  vi.clearAllMocks();
  mockAvailable.mockResolvedValue(true);
  mockBuild.mockResolvedValue({ id: "model" } as never);
});

describe("isRetryableModelError", () => {
  function httpErr(status: number): Error {
    const e = new Error("http error") as Error & { statusCode: number };
    e.statusCode = status;
    return e;
  }

  it("treats 408/429/5xx as retryable", () => {
    for (const status of [408, 429, 500, 502, 503, 529]) {
      expect(isRetryableModelError(httpErr(status))).toBe(true);
    }
  });

  it("treats 4xx (non-429) and 2xx as non-retryable", () => {
    expect(isRetryableModelError(httpErr(400))).toBe(false);
    expect(isRetryableModelError(httpErr(200))).toBe(false);
  });

  it("never retries user aborts", () => {
    const err = new Error("This operation was aborted");
    expect(isRetryableModelError(err)).toBe(false);
  });

  it("detects network-level errors from the message", () => {
    expect(isRetryableModelError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableModelError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableModelError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableModelError(new Error("some logic bug"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableModelError(undefined)).toBe(false);
    expect(isRetryableModelError("boom")).toBe(false);
  });
});

describe("generateTextWithFallback", () => {
  it("returns the primary result and records success", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    const out = await generateTextWithFallback({
      modelId: "primary",
      keys: {} as never,
      chain: [],
      run,
    });
    expect(out).toBe("ok");
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockRecordSuccess).toHaveBeenCalledWith("primary");
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

  it("falls back to the next provider on a retryable failure", async () => {
    mockBuild.mockImplementation(async (id) => ({ id } as never));
    const rateLimited = new Error("429 rate limited") as Error & { statusCode: number };
    rateLimited.statusCode = 429;
    const run = vi
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce("recovered");
    const out = await generateTextWithFallback({
      modelId: "primary",
      keys: {} as never,
      chain: ["fallback"],
      run,
    });
    expect(out).toBe("recovered");
    // Primary was attempted twice (initial + self-heal), then switched.
    expect(run).toHaveBeenCalledTimes(3);
    expect(mockRecordFailure).toHaveBeenCalledWith("primary");
    expect(mockRecordSuccess).toHaveBeenCalledWith("fallback");
  });

  it("self-heals the primary on a retryable failure instead of switching", async () => {
    mockBuild.mockImplementation(async (id) => ({ id } as never));
    const rateLimited = new Error("429 rate limited") as Error & { statusCode: number };
    rateLimited.statusCode = 429;
    const run = vi
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce("recovered");
    const out = await generateTextWithFallback({
      modelId: "primary",
      keys: {} as never,
      chain: ["fallback"],
      run,
    });
    expect(out).toBe("recovered");
    // Primary called exactly twice (initial + self-heal) and never fell back.
    expect(run).toHaveBeenCalledTimes(2);
    expect(mockBuild).toHaveBeenCalledTimes(2);
    expect(mockBuild).toHaveBeenCalledWith("primary", expect.anything(), expect.anything());
    expect(mockBuild).not.toHaveBeenCalledWith("fallback", expect.anything(), expect.anything());
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).toHaveBeenCalledWith("primary");
    expect(mockRecordSuccess).toHaveBeenCalledWith("primary");
  });

  it("switches to fallback when self-heal also fails", async () => {
    mockBuild.mockImplementation(async (id) => ({ id } as never));
    const rateLimited = new Error("429 rate limited") as Error & { statusCode: number };
    rateLimited.statusCode = 429;
    const run = vi
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce("recovered");
    const out = await generateTextWithFallback({
      modelId: "primary",
      keys: {} as never,
      chain: ["fallback"],
      run,
    });
    expect(out).toBe("recovered");
    expect(run).toHaveBeenCalledTimes(3);
    expect(mockRecordFailure).toHaveBeenCalledTimes(2);
    expect(mockRecordFailure).toHaveBeenCalledWith("primary");
    expect(mockRecordSuccess).toHaveBeenCalledWith("fallback");
  });

  it("does not self-heal or fall back on a non-retryable error", async () => {
    mockBuild.mockImplementation(async (id) => ({ id } as never));
    const run = vi.fn().mockRejectedValue(new Error("bad request"));
    await expect(
      generateTextWithFallback({
        modelId: "primary",
        keys: {} as never,
        chain: ["fallback"],
        run,
      }),
    ).rejects.toThrow("bad request");
    // One attempt only — no self-heal retry, no provider switch.
    expect(run).toHaveBeenCalledTimes(1);
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalledWith("fallback", expect.anything(), expect.anything());
  });

  it("skips providers whose breaker is open", async () => {
    mockAvailable.mockImplementation(async (id) => id !== "down");
    const run = vi.fn().mockResolvedValue("ok");
    await generateTextWithFallback({
      modelId: "down",
      keys: {} as never,
      chain: ["up"],
      run,
    });
    expect(mockBuild).toHaveBeenCalledWith("up", expect.anything(), expect.anything());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-retryable errors immediately", async () => {
    const run = vi.fn().mockRejectedValue(new Error("bad request"));
    await expect(
      generateTextWithFallback({
        modelId: "primary",
        keys: {} as never,
        chain: ["fallback"],
        run,
      }),
    ).rejects.toThrow("bad request");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every provider fails", async () => {
    const down = new Error("all down") as Error & { statusCode: number };
    down.statusCode = 503;
    const run = vi.fn().mockRejectedValue(down);
    await expect(
      generateTextWithFallback({
        modelId: "primary",
        keys: {} as never,
        chain: ["fallback"],
        run,
      }),
    ).rejects.toMatchObject({ message: "all down" });
    expect(mockRecordFailure).toHaveBeenCalledWith("primary");
    expect(mockRecordFailure).toHaveBeenCalledWith("fallback");
  });
});
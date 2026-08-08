import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, listCommands, register } from "./registry";

// registry.ts is a pure in-memory command registry (platform/web 层 I/O 边界).
// It maps command names to async/sync handlers and dispatches execute().

beforeEach(() => {
  // registry keeps module state in a Map; there is no reset API, so re-import
  // fresh state per test via a dynamic import after clearing is not possible.
  // Instead, tests use unique command names to stay isolated.
});

describe("register", () => {
  it("registers a handler that execute() can dispatch", async () => {
    const handler = vi.fn((args) => args);
    register("__test_reg_ok", handler);
    const out = await execute("__test_reg_ok", { a: 1 });
    expect(handler).toHaveBeenCalledWith({ a: 1 });
    expect(out).toEqual({ a: 1 });
  });

  it("supports synchronous handlers", async () => {
    register("__test_reg_sync", () => "sync-result");
    await expect(execute("__test_reg_sync", {})).resolves.toBe("sync-result");
  });

  it("supports async handlers", async () => {
    register("__test_reg_async", async () => "async-result");
    await expect(execute("__test_reg_async", {})).resolves.toBe("async-result");
  });

  it("overwrites a previously registered handler for the same name", async () => {
    register("__test_reg_over", () => "first");
    register("__test_reg_over", () => "second");
    await expect(execute("__test_reg_over", {})).resolves.toBe("second");
  });
});

describe("execute", () => {
  it("rejects with a descriptive error for an unknown command", async () => {
    await expect(execute("__test_does_not_exist", {})).rejects.toThrow(
      "Unknown command: __test_does_not_exist",
    );
  });

  it("propagates a handler's rejection", async () => {
    register("__test_reg_reject", () => {
      throw new Error("handler failed");
    });
    await expect(execute("__test_reg_reject", {})).rejects.toThrow(
      "handler failed",
    );
  });

  it("propagates an async handler rejection", async () => {
    register("__test_reg_reject_async", async () => {
      throw new Error("async failed");
    });
    await expect(execute("__test_reg_reject_async", {})).rejects.toThrow(
      "async failed",
    );
  });
});

describe("listCommands", () => {
  it("lists registered commands in sorted order", () => {
    register("__test_list_b", () => {});
    register("__test_list_a", () => {});
    const names = listCommands();
    expect(names).toContain("__test_list_a");
    expect(names).toContain("__test_list_b");
    // Sorted: a before b.
    const aIdx = names.indexOf("__test_list_a");
    const bIdx = names.indexOf("__test_list_b");
    expect(aIdx).toBeLessThan(bIdx);
  });
});

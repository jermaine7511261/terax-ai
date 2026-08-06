// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAsyncQuery } from "./useAsyncQuery";

describe("useAsyncQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts empty and idle", () => {
    const run = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() =>
      useAsyncQuery({ enabled: true, term: "ab", minLength: 2, debounceMs: 100, run }),
    );
    expect(result.current).toMatchObject({ results: [], loading: true, error: null });
    expect(run).not.toHaveBeenCalled();
  });

  it("does not run when the term is too short or not enabled", () => {
    const run = vi.fn().mockResolvedValue([]);
    renderHook(() =>
      useAsyncQuery({ enabled: true, term: "a", minLength: 2, debounceMs: 100, run }),
    );
    act(() => vi.advanceTimersByTime(500));
    expect(run).not.toHaveBeenCalled();

    const { result: r2 } = renderHook(() =>
      useAsyncQuery({ enabled: false, term: "abc", minLength: 2, debounceMs: 100, run }),
    );
    act(() => vi.advanceTimersByTime(500));
    expect(run).not.toHaveBeenCalled();
    expect(r2.current.results).toEqual([]);
  });

  it("debounces and sets results after the run resolves", async () => {
    const run = vi.fn().mockResolvedValue([{ id: 1 }]);
    const { result } = renderHook(() =>
      useAsyncQuery({ enabled: true, term: "abc", minLength: 2, debounceMs: 100, run }),
    );
    act(() => vi.advanceTimersByTime(99));
    expect(run).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(run).toHaveBeenCalledWith("abc");
    await act(async () => {});
    expect(result.current.results).toEqual([{ id: 1 }]);
    expect(result.current.loading).toBe(false);
  });

  it("clears results and records an error when the run rejects", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useAsyncQuery({ enabled: true, term: "abc", minLength: 2, debounceMs: 100, run }),
    );
    act(() => vi.advanceTimersByTime(100));
    await act(async () => {});
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBe("Error: boom");
  });

  it("retry re-runs when enabled and term is long enough", async () => {
    const run = vi.fn().mockResolvedValue([1]);
    const { result } = renderHook(() =>
      useAsyncQuery({ enabled: true, term: "abc", minLength: 2, debounceMs: 100, run }),
    );
    act(() => vi.advanceTimersByTime(100));
    await act(async () => {});
    act(() => result.current.retry());
    await act(async () => {});
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale late resolution from a superseded request", async () => {
    const resolvers: Array<(v: number[]) => void> = [];
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<number[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { result, rerender } = renderHook(
      ({ term }) => useAsyncQuery({ enabled: true, term, minLength: 2, debounceMs: 100, run }),
      { initialProps: { term: "abc" } },
    );
    act(() => vi.advanceTimersByTime(100));
    rerender({ term: "abd" });
    act(() => vi.advanceTimersByTime(100));
    expect(resolvers.length).toBe(2);
    // Resolve the FIRST (superseded) request late — must be ignored.
    await act(async () => {
      resolvers[0]([999]);
    });
    expect(result.current.results).toEqual([]);
    // The newer request's resolution still lands.
    await act(async () => {
      resolvers[1]([1]);
    });
    expect(result.current.results).toEqual([1]);
  });
});

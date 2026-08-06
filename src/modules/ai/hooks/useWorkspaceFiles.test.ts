// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => ({
  currentWorkspaceEnv: vi.fn(() => "local"),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/modules/workspace", () => workspaceMock);

import { useWorkspaceFiles } from "./useWorkspaceFiles";

// Module-level cache is shared; reset it between tests by triggering a fresh
// root key (unique per test) or by using different roots. We use unique roots.
let rootCounter = 0;
function freshRoot() {
  rootCounter += 1;
  return `/workspace-root-${rootCounter}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "fs_list_files") {
      return Promise.resolve({ files: ["a.ts", "b.ts"], truncated: false });
    }
    return Promise.resolve(null);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkspaceFiles", () => {
  it("returns empty state when workspaceRoot is null", async () => {
    const { result } = renderHook(() => useWorkspaceFiles(null, true));
    expect(result.current).toEqual({
      files: [],
      indexing: false,
      truncated: false,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("fetches files on mount when enabled", async () => {
    const root = freshRoot();
    const { result } = renderHook(() => useWorkspaceFiles(root, true));
    await waitFor(() => expect(result.current.files).toEqual(["a.ts", "b.ts"]));
    expect(result.current.truncated).toBe(false);
    expect(result.current.indexing).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_list_files",
      expect.objectContaining({ root }),
    );
  });

  it("sets indexing true while fetching", async () => {
    const root = freshRoot();
    let resolveFetch!: (v: { files: string[]; truncated: boolean }) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fs_list_files")
        return new Promise((res) => {
          resolveFetch = res;
        });
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useWorkspaceFiles(root, true));
    await act(async () => {});
    expect(result.current.indexing).toBe(true);
    await act(async () => {
      resolveFetch({ files: ["x"], truncated: false });
    });
    expect(result.current.indexing).toBe(false);
    expect(result.current.files).toEqual(["x"]);
  });

  it("does not fetch when enabled is false", async () => {
    const root = freshRoot();
    renderHook(() => useWorkspaceFiles(root, false));
    await act(async () => {});
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("caches the result so a re-mount with a fresh cache hit does not refetch", async () => {
    const root = freshRoot();
    const first = renderHook(() => useWorkspaceFiles(root, true));
    await waitFor(() => expect(first.result.current.files).toEqual(["a.ts", "b.ts"]));
    invokeMock.mockClear();
    // A second mount for the same root hits the module cache.
    const second = renderHook(() => useWorkspaceFiles(root, true));
    await act(async () => {});
    expect(second.result.current.files).toEqual(["a.ts", "b.ts"]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps prior state and drops indexing on fetch failure", async () => {
    const root = freshRoot();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fs_list_files") return Promise.reject(new Error("boom"));
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useWorkspaceFiles(root, true));
    await waitFor(() => expect(result.current.indexing).toBe(false));
    expect(result.current.files).toEqual([]);
  });
});

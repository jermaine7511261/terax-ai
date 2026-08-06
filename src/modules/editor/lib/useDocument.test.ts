// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => ({ currentWorkspaceEnv: vi.fn(() => "local") }));
const notifySavedMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
const prefsState = vi.hoisted(() => ({
  editorAutoSave: false,
  editorAutoSaveDelay: 1000,
}));
const prefsMock = vi.hoisted(() => {
  const usePreferencesStore = ((sel: (s: typeof prefsState) => unknown) =>
    sel(prefsState)) as unknown as {
    (sel: (s: typeof prefsState) => unknown): unknown;
    getState: () => typeof prefsState;
  };
  usePreferencesStore.getState = () => prefsState;
  return { usePreferencesStore };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/modules/workspace", () => workspaceMock);
vi.mock("@/modules/lsp", () => ({ notifyDocumentSaved: notifySavedMock }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/modules/settings/preferences", () => prefsMock);

import { useDocument } from "./useDocument";

const readText = (content: string, mtime = 100) => ({
  kind: "text" as const,
  content,
  size: content.length,
  mtime,
});

beforeEach(() => {
  invokeMock.mockReset();
  notifySavedMock.mockClear();
  toastMock.warning.mockClear();
  toastMock.error.mockClear();
  prefsState.editorAutoSave = false;
  prefsState.editorAutoSaveDelay = 1000;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "fs_read_file") {
      return Promise.resolve(readText("line1\nline2\n"));
    }
    if (cmd === "fs_stat") {
      return Promise.resolve({ size: 12, mtime: 100, kind: "file" });
    }
    if (cmd === "fs_write_file") {
      return Promise.resolve(100);
    }
    return Promise.resolve(null);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useDocument load", () => {
  it("loads a text file into a ready state", async () => {
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    expect(result.current.doc).toMatchObject({
      status: "ready",
      content: "line1\nline2\n",
    });
    expect(result.current.dirty).toBe(false);
  });

  it("handles a binary read", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fs_read_file") return Promise.resolve({ kind: "binary", size: 99 });
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useDocument({ path: "/ws/bin" }));
    await flush();
    expect(result.current.doc).toEqual({ status: "binary", size: 99 });
  });

  it("handles a read error", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fs_read_file") return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useDocument({ path: "/ws/missing" }));
    await flush();
    expect(result.current.doc.status).toBe("error");
  });
});

describe("useDocument dirty / save", () => {
  it("onChange marks the doc dirty and back to clean on revert", async () => {
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    act(() => result.current.onChange("edited"));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.onChange("line1\nline2\n"));
    expect(result.current.dirty).toBe(false);
  });

  it("save skips the write when the buffer matches the saved baseline", async () => {
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(invokeMock).not.toHaveBeenCalledWith("fs_write_file", expect.anything());
  });

  it("save writes the buffer and notifies LSP when dirty", async () => {
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    act(() => result.current.onChange("edited content"));
    await act(async () => {
      expect(await result.current.save()).toBe(true);
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_write_file",
      expect.objectContaining({ path: "/ws/a.ts", content: "edited content" }),
    );
    expect(notifySavedMock).toHaveBeenCalledWith("/ws/a.ts");
    expect(result.current.dirty).toBe(false);
  });

  it("save detects an external mtime conflict and warns", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "fs_read_file") return Promise.resolve(readText("orig"));
      if (cmd === "fs_stat") return Promise.resolve({ size: 1, mtime: 200, kind: "file" });
      if (cmd === "fs_write_file") return Promise.resolve(200);
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    act(() => result.current.onChange("edited"));
    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(toastMock.warning).toHaveBeenCalledWith(
      "磁盘上的文件已更改",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("fs_write_file", expect.anything());
  });

  it("reload returns false while dirty and refetches when clean", async () => {
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    act(() => result.current.onChange("edited"));
    expect(result.current.reload()).toBe(false);
    act(() => result.current.onChange("line1\nline2\n"));
    expect(result.current.reload()).toBe(true);
    await flush();
  });
});

describe("useDocument adoptDiskText", () => {
  it("adopts external disk content as the saved baseline", async () => {
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    await flush();
    act(() => result.current.onChange("buffer"));
    let content: string = "";
    act(() => {
      content = result.current.adoptDiskText("ext\r\ncontent", 999);
    });
    expect(content).toBe("ext\ncontent");
    expect(result.current.dirty).toBe(true); // buffer ("buffer") differs
  });
});

describe("useDocument autosave", () => {
  it("schedules a save after the delay when autosave is enabled", async () => {
    vi.useFakeTimers();
    prefsState.editorAutoSave = true;
    prefsState.editorAutoSaveDelay = 500;
    const { result } = renderHook(() => useDocument({ path: "/ws/a.ts" }));
    // Let the initial read resolve under fake timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.onChange("typing..."));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_write_file",
      expect.objectContaining({ content: "typing..." }),
    );
    vi.useRealTimers();
  });
});

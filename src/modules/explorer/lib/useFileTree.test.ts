// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const watchMock = vi.hoisted(() => ({
  listenFsChanged: vi.fn(() => Promise.resolve(() => {})),
  watchAdd: vi.fn(),
  watchRemove: vi.fn(),
}));
const workspaceMock = vi.hoisted(() => ({ currentWorkspaceEnv: vi.fn(() => "local") }));
const prefsMock = vi.hoisted(() => ({
  usePreferencesStore: (sel: (s: { showHidden: boolean; explorerGitDecorations: boolean }) => unknown) =>
    sel({ showHidden: false, explorerGitDecorations: true }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("./watch", () => watchMock);
vi.mock("@/modules/workspace", () => workspaceMock);
vi.mock("@/modules/settings/preferences", () => prefsMock);

import { dirname, joinPath, useFileTree } from "./useFileTree";
import type { DirEntry } from "./useFileTree";

const file = (name: string): DirEntry => ({
  name,
  kind: "file",
  size: 0,
  mtime: 0,
  gitignored: false,
});

const dir = (name: string): DirEntry => ({
  name,
  kind: "dir",
  size: 0,
  mtime: 0,
  gitignored: false,
});

beforeEach(() => {
  invokeMock.mockReset();
  watchMock.watchAdd.mockClear();
  watchMock.watchRemove.mockClear();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "fs_read_dir") return Promise.resolve([dir("sub"), file("a.txt")]);
    return Promise.resolve(null);
  });
});

describe("joinPath / dirname", () => {
  it("joinPath joins without duplicating slashes", () => {
    expect(joinPath("/ws", "a.txt")).toBe("/ws/a.txt");
    expect(joinPath("/ws/", "a.txt")).toBe("/ws/a.txt");
  });

  it("dirname returns the parent or root", () => {
    expect(dirname("/ws/sub")).toBe("/ws");
    expect(dirname("/ws/a.txt")).toBe("/ws");
    expect(dirname("/ws")).toBe("/");
    expect(dirname("/")).toBe("/");
    expect(dirname("a")).toBe("/");
  });
});

describe("useFileTree", () => {
  it("loads the root children on mount", async () => {
    const { result } = renderHook(() => useFileTree("/ws"));
    await act(async () => {
      await Promise.resolve();
    });
    const node = result.current.nodes["/ws"];
    expect(node?.status).toBe("loaded");
    if (node?.status === "loaded") {
      expect(node.entries.map((e) => e.name)).toEqual(["sub", "a.txt"]);
    }
  });

  it("toggle expands a child dir and fetches its listing", async () => {
    invokeMock.mockImplementation((cmd: string, args: { path?: string }) => {
      if (cmd === "fs_read_dir") {
        return Promise.resolve(
          args?.path === "/ws/sub" ? [file("x")] : [dir("sub"), file("a.txt")],
        );
      }
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useFileTree("/ws"));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.toggle("/ws/sub");
    });
    expect(result.current.expanded.has("/ws/sub")).toBe(true);
    expect(watchMock.watchAdd).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.nodes["/ws/sub"]?.status).toBe("loaded");
  });

  it("commitCreate creates a file under the pending parent", async () => {
    const { result } = renderHook(() => useFileTree("/ws"));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.beginCreate("/ws", "file");
    });
    await act(async () => {
      await result.current.commitCreate("new.txt");
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_create_file",
      expect.objectContaining({ path: "/ws/new.txt", workspace: "local" }),
    );
    expect(result.current.pendingCreate).toBeNull();
  });

  it("commitCreate ignores an empty trimmed name", async () => {
    const { result } = renderHook(() => useFileTree("/ws"));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.beginCreate("/ws", "file");
    });
    await act(async () => {
      await result.current.commitCreate("   ");
    });
    expect(invokeMock).not.toHaveBeenCalledWith("fs_create_file", expect.anything());
  });

  it("commitRename renames and notifies the callback", async () => {
    const onRenamed = vi.fn();
    const { result } = renderHook(() =>
      useFileTree("/ws", { onPathRenamed: onRenamed }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.beginRename("/ws/a.txt");
    });
    await act(async () => {
      await result.current.commitRename("b.txt");
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_rename",
      expect.objectContaining({ from: "/ws/a.txt", to: "/ws/b.txt" }),
    );
    expect(onRenamed).toHaveBeenCalledWith("/ws/a.txt", "/ws/b.txt");
  });

  it("commitRename is a no-op when the name is unchanged", async () => {
    const { result } = renderHook(() => useFileTree("/ws"));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.beginRename("/ws/a.txt");
    });
    await act(async () => {
      await result.current.commitRename("a.txt");
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "fs_rename",
      expect.objectContaining({ from: "/ws/a.txt" }),
    );
  });

  it("deletePath deletes and refreshes the parent", async () => {
    const onDeleted = vi.fn();
    const { result } = renderHook(() =>
      useFileTree("/ws", { onPathDeleted: onDeleted }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.deletePath("/ws/a.txt");
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_delete",
      expect.objectContaining({ path: "/ws/a.txt" }),
    );
    expect(onDeleted).toHaveBeenCalledWith("/ws/a.txt");
  });

  it("movePath moves a file into the target directory", async () => {
    const onRenamed = vi.fn();
    const { result } = renderHook(() =>
      useFileTree("/ws", { onPathRenamed: onRenamed }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.movePath("/other/c.txt", "/ws");
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "fs_rename",
      expect.objectContaining({ from: "/other/c.txt", to: "/ws/c.txt" }),
    );
    expect(onRenamed).toHaveBeenCalledWith("/other/c.txt", "/ws/c.txt");
  });

  it("movePath skips when the destination already contains the name", async () => {
    // Root listing already contains a.txt, so moving /other/a.txt into /ws
    // must be skipped.
    const { result } = renderHook(() => useFileTree("/ws"));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.movePath("/other/a.txt", "/ws");
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "fs_rename",
      expect.objectContaining({ to: "/ws/a.txt" }),
    );
  });
});

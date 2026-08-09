// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setTitleMock, mockFindLeafCwd } = vi.hoisted(() => ({
  setTitleMock: vi.fn().mockResolvedValue(undefined),
  mockFindLeafCwd: vi.fn().mockReturnValue(null),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: setTitleMock }),
}));
vi.mock("@/modules/terminal/lib/panes", () => ({
  findLeafCwd: mockFindLeafCwd,
}));

import { renderHook } from "@testing-library/react";
import { useWindowTitle } from "./useWindowTitle";

beforeEach(() => {
  setTitleMock.mockClear();
  mockFindLeafCwd.mockClear();
  mockFindLeafCwd.mockReturnValue(null);
  document.title = "";
})

describe("useWindowTitle", () => {
  it("falls back to the app name when nothing is focused", () => {
    renderHook(() => useWindowTitle(undefined, null));
    expect(document.title).toBe("YaMet");
    expect(setTitleMock).toHaveBeenCalledWith("YaMet");
  });

  it("shows just the project when a terminal sits at the project root", () => {
    renderHook(() => useWindowTitle(undefined, "/ws/YaMet"));
    expect(setTitleMock).toHaveBeenCalledWith("YaMet");
  });

  it("shows project — label for a focused editor tab", () => {
    const tab = { kind: "editor", title: "app.tsx" } as never;
    renderHook(() => useWindowTitle(tab, "/ws/YaMet"));
    expect(setTitleMock).toHaveBeenCalledWith("YaMet — app.tsx");
  });

  it("collapses when the label equals the project", () => {
    const tab = { kind: "editor", title: "YaMet" } as never;
    renderHook(() => useWindowTitle(tab, "/ws/YaMet"));
    expect(setTitleMock).toHaveBeenCalledWith("YaMet");
  });

  it("uses the active terminal pane cwd basename", () => {
    mockFindLeafCwd.mockReturnValue("/ws/yamet/src");
    const tab = {
      kind: "terminal",
      title: "zsh",
      cwd: "/ws/YaMet",
      paneTree: null,
      activeLeafId: 3,
    } as never;
    renderHook(() => useWindowTitle(tab, "/ws/YaMet"));
    expect(setTitleMock).toHaveBeenCalledWith("YaMet — src");
  });
});

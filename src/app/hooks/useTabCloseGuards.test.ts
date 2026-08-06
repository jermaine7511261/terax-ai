// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";

const nextActiveMock = vi.hoisted(() => vi.fn());
const leafHasFgMock = vi.hoisted(() => vi.fn(async () => false));
const leafIdsMock = vi.hoisted(() => vi.fn(() => [] as number[]));

vi.mock("@/modules/tabs", () => ({
  nextActiveInSpace: nextActiveMock,
}));
vi.mock("@/modules/terminal", () => ({
  leafHasForegroundProcess: leafHasFgMock,
  leafIds: leafIdsMock,
}));

import { useTabCloseGuards } from "./useTabCloseGuards";

function editorTab(id: number, dirty: boolean): Tab {
  return { id, kind: "editor", spaceId: "default", title: `f${id}.ts`, path: `/p/f${id}.ts`, dirty, preview: false };
}
function terminalTab(id: number): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "default",
    title: `t${id}`,
    paneTree: { kind: "leaf", id: 100 + id },
    activeLeafId: 100 + id,
  };
}

beforeEach(() => {
  nextActiveMock.mockReset();
  leafHasFgMock.mockReset();
  leafIdsMock.mockReset();
  leafHasFgMock.mockResolvedValue(false);
  leafIdsMock.mockReturnValue([100]);
  nextActiveMock.mockReturnValue(99);
});

describe("useTabCloseGuards", () => {
  it("disposes a clean non-terminal tab immediately", async () => {
    const dispose = vi.fn();
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [editorTab(1, false)], disposeTab: dispose }));
    nextActiveMock.mockReturnValue(0);
    await act(async () => result.current.handleClose(1));
    expect(dispose).toHaveBeenCalledWith(1);
    expect(result.current.pendingCloseTab).toBeNull();
  });

  it("routes a dirty editor through the close-confirm dialog", async () => {
    const dispose = vi.fn();
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [editorTab(1, true)], disposeTab: dispose }));
    nextActiveMock.mockReturnValue(0);
    await act(async () => result.current.handleClose(1));
    expect(dispose).not.toHaveBeenCalled();
    expect(result.current.pendingCloseTab).toBe(1);
    act(() => result.current.confirmClose());
    expect(dispose).toHaveBeenCalledWith(1);
    expect(result.current.pendingCloseTab).toBeNull();
  });

  it("cancelClose clears the pending dirty editor without disposing", async () => {
    const dispose = vi.fn();
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [editorTab(1, true)], disposeTab: dispose }));
    nextActiveMock.mockReturnValue(0);
    await act(async () => result.current.handleClose(1));
    act(() => result.current.cancelClose());
    expect(result.current.pendingCloseTab).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("routes a terminal with a live foreground process through its own dialog", async () => {
    const dispose = vi.fn();
    leafHasFgMock.mockResolvedValue(true);
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [terminalTab(1)], disposeTab: dispose }));
    nextActiveMock.mockReturnValue(0);
    await act(async () => result.current.handleClose(1));
    expect(result.current.pendingTerminalCloseTab).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    act(() => result.current.confirmTerminalClose());
    expect(dispose).toHaveBeenCalledWith(1);
    expect(result.current.pendingTerminalCloseTab).toBeNull();
  });

  it("cancelTerminalClose clears the pending terminal close", async () => {
    const dispose = vi.fn();
    leafHasFgMock.mockResolvedValue(true);
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [terminalTab(1)], disposeTab: dispose }));
    nextActiveMock.mockReturnValue(0);
    await act(async () => result.current.handleClose(1));
    act(() => result.current.cancelTerminalClose());
    expect(result.current.pendingTerminalCloseTab).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("disposes an idle terminal directly", async () => {
    const dispose = vi.fn();
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [terminalTab(1)], disposeTab: dispose }));
    nextActiveMock.mockReturnValue(0);
    await act(async () => result.current.handleClose(1));
    expect(dispose).toHaveBeenCalledWith(1);
    expect(result.current.pendingTerminalCloseTab).toBeNull();
  });

  it("skips the dialog entirely when it is the last tab in its space", async () => {
    const dispose = vi.fn();
    nextActiveMock.mockReturnValue(null);
    const { result } = renderHook(() => useTabCloseGuards({ tabs: [editorTab(1, true)], disposeTab: dispose }));
    await act(async () => result.current.handleClose(1));
    expect(dispose).not.toHaveBeenCalled();
    expect(result.current.pendingCloseTab).toBeNull();
  });

  it("handlePathDeleted disposes matching clean editors and batches dirty ones", async () => {
    const dispose = vi.fn();
    const tabs = [editorTab(1, false), editorTab(2, true), editorTab(3, true)];
    const { result } = renderHook(() => useTabCloseGuards({ tabs, disposeTab: dispose }));
    act(() => result.current.handlePathDeleted("/p"));
    // f1 clean under /p disposed; f2/f3 dirty batched into pendingDeleteTabs.
    expect(dispose).toHaveBeenCalledWith(1);
    expect(result.current.pendingDeleteTabs).toEqual([2, 3]);
  });

  it("handlePathDeleted ignores tabs outside the deleted path prefix", async () => {
    const dispose = vi.fn();
    const tabs = [editorTab(1, false), editorTab(2, true)];
    const { result } = renderHook(() => useTabCloseGuards({ tabs, disposeTab: dispose }));
    act(() => result.current.handlePathDeleted("/other"));
    expect(dispose).not.toHaveBeenCalled();
    expect(result.current.pendingDeleteTabs).toBeNull();
  });

  it("confirmDeleteClose disposes all pending tabs", () => {
    const dispose = vi.fn();
    const tabs = [editorTab(1, true), editorTab(2, true)];
    const { result } = renderHook(() => useTabCloseGuards({ tabs, disposeTab: dispose }));
    act(() => result.current.handlePathDeleted("/p"));
    expect(result.current.pendingDeleteTabs).toEqual([1, 2]);
    act(() => result.current.confirmDeleteClose());
    expect(dispose).toHaveBeenCalledWith(1);
    expect(dispose).toHaveBeenCalledWith(2);
    expect(result.current.pendingDeleteTabs).toBeNull();
  });

  it("cancelDeleteClose clears pending deletes without disposing", () => {
    const dispose = vi.fn();
    const tabs = [editorTab(1, true)];
    const { result } = renderHook(() => useTabCloseGuards({ tabs, disposeTab: dispose }));
    act(() => result.current.handlePathDeleted("/p"));
    act(() => result.current.cancelDeleteClose());
    expect(result.current.pendingDeleteTabs).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
  });
});

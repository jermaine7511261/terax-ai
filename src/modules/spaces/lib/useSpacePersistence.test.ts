// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeMock = vi.hoisted(() => ({
  saveState: vi.fn(
    async (_spaceId: string, _payload: { tabs: unknown[]; activeTabIndex: number }) => {},
  ),
  saveSpacesList: vi.fn(async () => {}),
  saveActiveId: vi.fn(async () => {}),
  saveRecent: vi.fn(async () => {}),
  deleteSpaceData: vi.fn(async () => {}),
  newSpaceId: () => "space-new",
  recentWith: (list: string[], id: string) =>
    [id, ...list.filter((x) => x !== id)].slice(0, 8),
}));

vi.mock("./store", () => storeMock);

import { useSpaces } from "./useSpaces";
import { useSpacePersistence } from "./useSpacePersistence";

function editorTab(id: number, spaceId = "s1") {
  return {
    id,
    kind: "editor",
    spaceId,
    title: `t${id}`,
    path: `/a/${id}.ts`,
    dirty: false,
    preview: false,
  } as never;
}

beforeEach(() => {
  storeMock.saveState.mockClear();
  storeMock.saveSpacesList.mockClear();
  storeMock.saveActiveId.mockClear();
  storeMock.saveRecent.mockClear();
  useSpaces.setState({
    spaces: [],
    activeId: null,
    recent: [],
    hydrated: false,
    initialActiveIndex: {},
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSpacePersistence", () => {
  it("does not flush while disabled", () => {
    renderHook(() =>
      useSpacePersistence({
        tabs: [editorTab(1)],
        activeId: 1,
        activeSpaceId: "s1",
        enabled: false,
      }),
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(storeMock.saveState).not.toHaveBeenCalled();
  });

  it("flushes after the debounce with serialized tabs and the active index", () => {
    renderHook(() =>
      useSpacePersistence({
        tabs: [editorTab(1), editorTab(2)],
        activeId: 2,
        activeSpaceId: "s1",
        enabled: true,
      }),
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(storeMock.saveState).toHaveBeenCalledTimes(1);
    const [spaceId, payload] = storeMock.saveState.mock.calls[0];
    expect(spaceId).toBe("s1");
    expect(payload.tabs).toHaveLength(2);
    expect(payload.activeTabIndex).toBe(1);
  });

  it("groups tabs by space and writes each space once", () => {
    renderHook(() =>
      useSpacePersistence({
        tabs: [editorTab(1, "s1"), editorTab(2, "s2")],
        activeId: 1,
        activeSpaceId: "s1",
        enabled: true,
      }),
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(storeMock.saveState).toHaveBeenCalledTimes(2);
    expect(storeMock.saveState.mock.calls.map((c) => c[0]).sort()).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("dedupes an identical snapshot on re-render", () => {
    const { rerender } = renderHook(
      ({ tabs }) =>
        useSpacePersistence({
          tabs,
          activeId: 1,
          activeSpaceId: "s1",
          enabled: true,
        }),
      { initialProps: { tabs: [editorTab(1)] } },
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(storeMock.saveState).toHaveBeenCalledTimes(1);
    rerender({ tabs: [editorTab(1)] });
    act(() => vi.advanceTimersByTime(3_000));
    expect(storeMock.saveState).toHaveBeenCalledTimes(1);
  });

  it("writes again when the active tab index changes", () => {
    const { rerender } = renderHook(
      ({ activeId }) =>
        useSpacePersistence({
          tabs: [editorTab(1), editorTab(2)],
          activeId,
          activeSpaceId: "s1",
          enabled: true,
        }),
      { initialProps: { activeId: 1 } },
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(storeMock.saveState).toHaveBeenCalledTimes(1);
    rerender({ activeId: 2 });
    act(() => vi.advanceTimersByTime(3_000));
    expect(storeMock.saveState).toHaveBeenCalledTimes(2);
    expect(storeMock.saveState.mock.calls[1][1].activeTabIndex).toBe(1);
  });

  it("flushes immediately on window blur", () => {
    renderHook(() =>
      useSpacePersistence({
        tabs: [editorTab(1)],
        activeId: 1,
        activeSpaceId: "s1",
        enabled: true,
      }),
    );
    expect(storeMock.saveState).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event("blur")));
    expect(storeMock.saveState).toHaveBeenCalledTimes(1);
  });

  it("flushes on unmount", () => {
    const { unmount } = renderHook(() =>
      useSpacePersistence({
        tabs: [editorTab(1)],
        activeId: 1,
        activeSpaceId: "s1",
        enabled: true,
      }),
    );
    act(() => unmount());
    expect(storeMock.saveState).toHaveBeenCalledTimes(1);
  });

  it("seeds initial active indices from disk so the first flush preserves them", () => {
    useSpaces.setState({ initialActiveIndex: { s2: 3 } });
    const tabs = [editorTab(1, "s1"), editorTab(9, "s2")];
    renderHook(() =>
      useSpacePersistence({
        tabs,
        activeId: 1,
        activeSpaceId: "s1",
        enabled: true,
      }),
    );
    act(() => vi.advanceTimersByTime(3_000));
    const s2Call = storeMock.saveState.mock.calls.find((c) => c[0] === "s2");
    expect(s2Call?.[1].activeTabIndex).toBe(3);
  });
});

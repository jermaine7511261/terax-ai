// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/settings/store")>();
  return { ...actual, setZoomLevel: vi.fn() };
});

import { setZoomLevel } from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useZoom } from "./useZoom";

const mockSetZoomLevel = vi.mocked(setZoomLevel);

const CSS_VAR = "--app-zoom";

beforeEach(() => {
  mockSetZoomLevel.mockClear();
  usePreferencesStore.setState({
    zoomLevel: 1,
    hydrated: true,
  } as never);
  document.documentElement.style.removeProperty(CSS_VAR);
});

describe("useZoom", () => {
  it("applies the zoom to the DOM once hydrated", () => {
    usePreferencesStore.setState({ zoomLevel: 1.25 } as never);
    renderHook(() => useZoom());
    expect(
      document.documentElement.style.getPropertyValue(CSS_VAR),
    ).toBe("1.25");
  });

  it("does not apply zoom before hydration", () => {
    usePreferencesStore.setState({ zoomLevel: 1.25, hydrated: false } as never);
    renderHook(() => useZoom());
    expect(document.documentElement.style.getPropertyValue(CSS_VAR)).toBe("");
  });

  it("zoomIn steps up by 0.1", () => {
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomIn());
    expect(mockSetZoomLevel).toHaveBeenCalledWith(1.1);
  });

  it("zoomIn clamps at the maximum", () => {
    usePreferencesStore.setState({ zoomLevel: 1.95 } as never);
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomIn());
    expect(mockSetZoomLevel).toHaveBeenCalledWith(2.0);
  });

  it("zoomOut steps down by 0.1", () => {
    usePreferencesStore.setState({ zoomLevel: 0.8 } as never);
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomOut());
    expect(mockSetZoomLevel).toHaveBeenCalledWith(0.7);
  });

  it("zoomOut clamps at the minimum", () => {
    usePreferencesStore.setState({ zoomLevel: 0.55 } as never);
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomOut());
    expect(mockSetZoomLevel).toHaveBeenCalledWith(0.5);
  });

  it("zoomReset restores 1.0", () => {
    usePreferencesStore.setState({ zoomLevel: 1.7 } as never);
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomReset());
    expect(mockSetZoomLevel).toHaveBeenCalledWith(1.0);
  });

  it("zoomReset is a no-op when already at 1.0", () => {
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomReset());
    expect(mockSetZoomLevel).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  POOL_MAX_SIZE,
  applyWebglPreference,
  configureRendererPool,
  forEachSlot,
  poolSize,
  poolSlotStats,
} from "./rendererPool";

// rendererPool.ts manages a module-level singleton slot pool whose slots are
// created lazily by acquireSlot() — which constructs a real xterm Terminal,
// appends to a recycler <div>, and drives ResizeObserver/canvas/WebGL. None of
// that is available in the vitest node environment without jsdom + a canvas
// shim, so acquireSlot/releaseSlot are intentionally NOT exercised here. The
// tests below cover the pure, DOM-free pool-state surface instead.

describe("rendererPool — pure pool state", () => {
  it("POOL_MAX_SIZE caps the slot pool at 5", () => {
    expect(POOL_MAX_SIZE).toBe(5);
  });

  it("starts with an empty pool", () => {
    expect(poolSize()).toBe(0);
  });

  it("poolSlotStats returns no entries for an empty pool", () => {
    expect(poolSlotStats()).toEqual([]);
  });

  it("forEachSlot visits nothing on an empty pool", () => {
    const fn = vi.fn();
    forEachSlot(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("configureRendererPool accepts an adapter without throwing", () => {
    const adapter = {
      resolveLeaf: () => null,
      evictLeaf: () => {},
      isLeafFocused: () => false,
      isLeafBlocks: () => false,
      isLeafBusy: () => false,
      isLeafVisible: () => false,
      storeSnapshot: () => {},
    };
    expect(() => configureRendererPool(adapter)).not.toThrow();
  });

  it("applyWebglPreference(true) is a safe no-op on an empty pool", () => {
    expect(() => applyWebglPreference(true)).not.toThrow();
    expect(poolSize()).toBe(0);
  });

  it("applyWebglPreference(false) is a safe no-op on an empty pool", () => {
    expect(() => applyWebglPreference(false)).not.toThrow();
    expect(poolSize()).toBe(0);
  });

  it("applyWebglPreference can be toggled repeatedly without side effects", () => {
    expect(() => {
      applyWebglPreference(true);
      applyWebglPreference(false);
      applyWebglPreference(true);
    }).not.toThrow();
  });
});

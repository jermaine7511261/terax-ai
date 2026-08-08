/**
 * Browser window management adapter.
 * Maps Tauri window operations to browser equivalents.
 */

import type { IWindowAdapter, UnlistenFn } from "../types";

// Simple event bus for window events. `Listened` is a generic listener that
// accepts any payload shape; `Listener` is the concrete unknown-payload one
// stored in the bus.
type Listened<T> = (event: { payload: T }) => void;
type Listener = Listened<unknown>;
const eventBus = new Map<string, Set<Listener>>();

function onBrowserEvent<T>(event: string, listener: Listened<T>): Promise<UnlistenFn> {
  if (!eventBus.has(event)) eventBus.set(event, new Set());
  eventBus.get(event)?.add(listener as Listener);
  return Promise.resolve(() => eventBus.get(event)?.delete(listener as Listener));
}

// Wire browser events to the bus
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    eventBus.get("resized")?.forEach((fn) => {
      fn({ payload: {} });
    });
  });
  window.addEventListener("focus", () => {
    eventBus.get("focus")?.forEach((fn) => {
      fn({ payload: true });
    });
  });
  window.addEventListener("blur", () => {
    eventBus.get("focus")?.forEach((fn) => {
      fn({ payload: false });
    });
  });
}

const noop = async () => {};

export const webWindow: IWindowAdapter = {
  show: noop,
  hide: noop,
  close() {
    window.close();
    return Promise.resolve();
  },
  setTitle(title: string) {
    document.title = title;
    return Promise.resolve();
  },
  isMaximized() {
    return Promise.resolve(!!document.fullscreenElement);
  },
  maximize() {
    return document.documentElement.requestFullscreen().then(() => {}).catch(() => {});
  },
  unmaximize() {
    return document.exitFullscreen().then(() => {}).catch(() => {});
  },
  toggleMaximize() {
    if (document.fullscreenElement) return this.unmaximize();
    return this.maximize();
  },
  isMinimized() {
    return Promise.resolve(false); // No concept of minimized in browser
  },
  minimize() {
    return Promise.resolve(); // No-op in browser
  },
  center() {
    return Promise.resolve(); // No-op in browser
  },
  setResizable(_resizable: boolean) {
    return Promise.resolve(); // Not controllable in browser
  },
  onResized(handler) {
    return onBrowserEvent("resized", handler);
  },
  onMoved(_handler) {
    return Promise.resolve(() => {}); // No move events in browser
  },
  onFocusedChanged(handler) {
    return onBrowserEvent("focus", handler);
  },
  onFocusChanged(handler) {
    return onBrowserEvent("focus", handler);
  },
  onCloseRequested(handler) {
    // Warn before unload
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      handler({ payload: {} });
    };
    window.addEventListener("beforeunload", fn);
    return Promise.resolve(() => window.removeEventListener("beforeunload", fn));
  },
  listen(event: string, handler) {
    return onBrowserEvent(event, handler);
  },
  onDragDropEvent(_handler) {
    return Promise.resolve(() => {}); // No drag-drop in browser (use File API instead)
  },
  setFocus() {
    window.focus();
    return Promise.resolve();
  },
};

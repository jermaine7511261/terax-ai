import type { IWindowAdapter } from "../types";

export const webWindow: IWindowAdapter = {
  async show() {},
  async hide() {},
  async close() {
    window.close();
  },
  async setTitle(title: string) {
    document.title = title;
  },
  async isMaximized() {
    return document.fullscreenElement !== null;
  },
  async maximize() {
    document.documentElement.requestFullscreen?.();
  },
  async unmaximize() {
    document.exitFullscreen?.();
  },
  async toggleMaximize() {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else await document.documentElement.requestFullscreen?.();
  },
  async isMinimized() {
    return false;
  },
  async minimize() {
    // No browser equivalent
  },
  async center() {},
  async setResizable() {},
  onResized: () => Promise.resolve(() => {}),
  onMoved: () => Promise.resolve(() => {}),
  onFocusedChanged: () => Promise.resolve(() => {}),
  onFocusChanged: () => Promise.resolve(() => {}),
  onCloseRequested: () => Promise.resolve(() => {}),
  listen: () => Promise.resolve(() => {}),
  onDragDropEvent: () => Promise.resolve(() => {}),
  setFocus: async () => {},
};

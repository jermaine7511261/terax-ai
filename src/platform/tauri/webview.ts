import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { IWebviewAdapter, IWindowAdapter, UnlistenFn } from "../types";

function wrapWebviewWindow(w: any): IWindowAdapter {
  return {
    show: () => w.show(),
    hide: () => w.hide(),
    close: () => w.close(),
    setTitle: (t) => w.setTitle(t),
    isMaximized: () => w.isMaximized(),
    maximize: () => w.maximize(),
    unmaximize: () => w.unmaximize(),
    toggleMaximize: async () => {
      if (await w.isMaximized()) await w.unmaximize();
      else await w.maximize();
    },
    isMinimized: () => w.isMinimized(),
    minimize: () => w.minimize(),
    center: () => w.center(),
    setResizable: (r) => w.setResizable(r),
    onResized: (h) => w.onResized(h as any).then((u: UnlistenFn) => u),
    onMoved: (h) => w.onMoved(h as any).then((u: UnlistenFn) => u),
    onFocusedChanged: (h) =>
      w.onFocusChanged(h as any).then((u: UnlistenFn) => u),
    onCloseRequested: (h) =>
      w.onCloseRequested(h as any).then((u: UnlistenFn) => u),
    onFocusChanged: (h) =>
      w.onFocusChanged(h as any).then((u: UnlistenFn) => u),
    listen: (event, handler) =>
      w.listen(event, handler as any).then((u: UnlistenFn) => u),
    onDragDropEvent: (handler) =>
      (w.onDragDropEvent?.(handler as any) ?? Promise.resolve(() => {})).then((u: UnlistenFn) => u),
    setFocus: () => w.setFocus(),
  };
}

export const tauriWebview: IWebviewAdapter = {
  getCurrentWebview() {
    try {
      const w = getCurrentWebviewWindow();
      return w ? wrapWebviewWindow(w) : null;
    } catch {
      return null;
    }
  },
  getCurrentWebviewWindow(_label: string) {
    try {
      // Tauri v2: getCurrentWebviewWindow() returns the calling webview's window.
      // For cross-window access, use WebviewWindow constructor.
      const w = getCurrentWebviewWindow();
      return w ? wrapWebviewWindow(w) : null;
    } catch {
      return null;
    }
  },
};

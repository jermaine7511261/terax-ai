import { getCurrentWindow } from "@tauri-apps/api/window";
import type { IWindowAdapter, UnlistenFn } from "../types";

function mapWindow() {
  return getCurrentWindow();
}

export const tauriWindow: IWindowAdapter = {
  show: () => mapWindow().show(),
  hide: () => mapWindow().hide(),
  close: () => mapWindow().close(),
  setTitle: (t) => mapWindow().setTitle(t),
  isMaximized: () => mapWindow().isMaximized(),
  maximize: () => mapWindow().maximize(),
  unmaximize: () => mapWindow().unmaximize(),
  toggleMaximize: async () => {
    const w = mapWindow();
    if (await w.isMaximized()) await w.unmaximize();
    else await w.maximize();
  },
  isMinimized: () => mapWindow().isMinimized(),
  minimize: () => mapWindow().minimize(),
  center: () => mapWindow().center(),
  setResizable: (r) => mapWindow().setResizable(r),
  onResized: (h) => mapWindow().onResized(h as any).then((u: UnlistenFn) => u),
  onMoved: (h) => mapWindow().onMoved(h as any).then((u: UnlistenFn) => u),
  onFocusedChanged: (h) =>
    mapWindow().onFocusChanged(h as any).then((u: UnlistenFn) => u),
  onFocusChanged: (h) =>
    mapWindow().onFocusChanged(h as any).then((u: UnlistenFn) => u),
  onCloseRequested: (h) =>
    mapWindow().onCloseRequested(h as any).then((u: UnlistenFn) => u),
  listen: (event, handler) =>
    mapWindow().listen(event, handler as any).then((u: UnlistenFn) => u),
  onDragDropEvent: (handler) =>
    (mapWindow() as any).onDragDropEvent(handler as any).then((u: UnlistenFn) => u),
  setFocus: () => mapWindow().setFocus(),
};

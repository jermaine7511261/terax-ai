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
  onResized: (h) =>
    mapWindow().onResized((e) => h({ payload: e.payload })).then((u: UnlistenFn) => u),
  onMoved: (h) =>
    mapWindow().onMoved((e) => h({ payload: e.payload })).then((u: UnlistenFn) => u),
  onFocusedChanged: (h) =>
    mapWindow().onFocusChanged((e) => h({ payload: e.payload })).then((u: UnlistenFn) => u),
  onFocusChanged: (h) =>
    mapWindow().onFocusChanged((e) => h({ payload: e.payload })).then((u: UnlistenFn) => u),
  onCloseRequested: (h) =>
    mapWindow().onCloseRequested((e) => h({ payload: e as unknown })).then((u: UnlistenFn) => u),
  listen: <T>(event: string, handler: (event: { payload: T }) => void) =>
    mapWindow().listen(event, (e) => handler({ payload: e.payload as T })).then((u: UnlistenFn) => u),
  onDragDropEvent: (handler) =>
    mapWindow()
      .onDragDropEvent((e) =>
        handler({
          payload: e.payload as {
            type: string;
            paths: string[];
            position: { x: number; y: number };
          },
        }),
      )
      .then((u: UnlistenFn) => u),
  setFocus: () => mapWindow().setFocus(),
};

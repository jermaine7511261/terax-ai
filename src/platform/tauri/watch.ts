import { invoke } from "@tauri-apps/api/core";
import type { IWatchAdapter, WatchEvent } from "../types";

export const tauriWatch: IWatchAdapter = {
  async watch(path: string, _handler: (event: WatchEvent) => void) {
    return invoke<number>("fs_watch", { path });
    // TODO: wire up event listener for file system change events
    // The actual event stream comes through Tauri events; we need
    // to hook into the event bus once the watch command emits.
  },
  async unwatch(handle: number) {
    await invoke("fs_unwatch", { handle });
  },
};

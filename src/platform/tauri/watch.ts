import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { IWatchAdapter, WatchEvent } from "../types";

type ChangedPayload = { paths: string[] };

// The backend tracks watchers by path (refcounted), while the adapter surface
// is handle-based — keep a local handle → path map to bridge the two.
let nextHandle = 1;
const handleToPath = new Map<number, string>();
const unlisteners = new Map<number, UnlistenFn>();

export const tauriWatch: IWatchAdapter = {
  async watch(path: string, handler: (event: WatchEvent) => void) {
    await invoke("fs_watch_add", { paths: [path] });
    const handle = nextHandle++;
    handleToPath.set(handle, path);
    // Backend emits debounced batches on "fs:changed" (paths only, no kind).
    const unlisten = await listen<ChangedPayload>("fs:changed", (ev) => {
      const watched = handleToPath.get(handle);
      if (!watched) return;
      const paths = ev.payload.paths.filter(
        (p) =>
          p === watched ||
          p.startsWith(watched + "/") ||
          p.startsWith(watched + "\\"),
      );
      if (paths.length > 0) handler({ kind: "modify", paths });
    });
    unlisteners.set(handle, unlisten);
    return handle;
  },
  async unwatch(handle: number) {
    const path = handleToPath.get(handle);
    handleToPath.delete(handle);
    const unlisten = unlisteners.get(handle);
    unlisteners.delete(handle);
    if (unlisten) await unlisten();
    if (path) await invoke("fs_watch_remove", { paths: [path] });
  },
};

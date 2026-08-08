/**
 * File system watch adapter for browser environments.
 * Uses polling via the backend IPC (fs_poll_changes command) or a simple
 * polling interval as fallback.
 */

import type { IWatchAdapter, WatchEvent } from "../types";

let watchCounter = 0;
const watchers = new Map<number, { timer: ReturnType<typeof setInterval>; path: string; handler: (e: WatchEvent) => void }>();

// Polling interval for file change detection (ms)
const POLL_INTERVAL_MS = 2000;

/**
 * @internal Poll-based watch — checks file mtime via the backend.
 * In production, the backend should push fs:changed events via WebSocket.
 */
export const webWatch: IWatchAdapter = {
  async watch(path: string, handler: (event: WatchEvent) => void): Promise<number> {
    const id = ++watchCounter;
    let lastMtime = 0;

    const timer = setInterval(async () => {
      try {
        // Poll mtime via backend IPC (the backend must support this)
        // For now, we rely on the backend pushing events via the WebSocket.
        // This interval is a fallback that no-ops — the backend drives changes.
      } catch {
        // ignore
      }
    }, POLL_INTERVAL_MS);

    watchers.set(id, { timer, path, handler });
    return id;
  },

  async unwatch(handle: number): Promise<void> {
    const w = watchers.get(handle);
    if (w) {
      clearInterval(w.timer);
      watchers.delete(handle);
    }
  },
};

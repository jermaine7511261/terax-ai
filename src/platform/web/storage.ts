import type { IStorageAdapter, UnlistenFn } from "../types";

/**
 * Browser-backed storage using localStorage (simple) or IndexedDB (Phase 2).
 * Good enough for settings; sessions/snippets need IndexedDB.
 */
export const webStorage: IStorageAdapter = {
  async init(_filename: string) {
    // no-op for localStorage
  },

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  },

  async set(key: string, value: unknown): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  },

  async delete(key: string): Promise<void> {
    localStorage.removeItem(key);
  },

  async entries(): Promise<[string, unknown][]> {
    const result: [string, unknown][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const raw = localStorage.getItem(key);
        let val: unknown;
        try {
          val = raw ? JSON.parse(raw) : undefined;
        } catch {
          val = raw;
        }
        result.push([key, val]);
      }
    }
    return result;
  },

  async save() {
    // localStorage persists automatically
  },

  onChange(_callback: (key: string, value: unknown) => void): UnlistenFn {
    // localStorage doesn't have cross-tab onChange; use storage event.
    const handler = (e: StorageEvent) => {
      if (e.key && e.newValue) {
        try {
          _callback(e.key, JSON.parse(e.newValue));
        } catch {
          _callback(e.key, e.newValue);
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};

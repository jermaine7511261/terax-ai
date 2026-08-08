import type { IStorageAdapter, UnlistenFn } from "../types";

/**
 * Per-file storage factory for the web platform. Keys are namespaced by
 * filename so multiple logical stores (themes, sessions, snippets, …) don't
 * collide in the shared localStorage namespace.
 */
export function createWebStorage(filename: string): IStorageAdapter {
  const prefix = `${filename}:`;
  return {
    async init() {},
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const raw = localStorage.getItem(prefix + key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      localStorage.setItem(prefix + key, JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      localStorage.removeItem(prefix + key);
    },
    async entries(): Promise<[string, unknown][]> {
      const out: [string, unknown][] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) {
          const inner = k.slice(prefix.length);
          const raw = localStorage.getItem(k);
          let val: unknown;
          try {
            val = raw ? JSON.parse(raw) : undefined;
          } catch {
            val = raw;
          }
          out.push([inner, val]);
        }
      }
      return out;
    },
    async save() {
      // localStorage persists automatically
    },
    onChange(callback: (key: string, value: unknown) => void): UnlistenFn {
      const handler = (e: StorageEvent) => {
        if (e.key?.startsWith(prefix) && e.newValue !== null) {
          try {
            callback(e.key.slice(prefix.length), JSON.parse(e.newValue));
          } catch {
            callback(e.key.slice(prefix.length), e.newValue);
          }
        }
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
  };
}

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

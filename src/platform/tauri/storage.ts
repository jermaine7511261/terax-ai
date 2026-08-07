import { LazyStore } from "@tauri-apps/plugin-store";
import type { IStorageAdapter, UnlistenFn } from "../types";

/**
 * Tauri storage adapter backed by `@tauri-apps/plugin-store` LazyStore.
 *
 * Each logical store is a separate file on disk. The adapter lazily
 * creates and caches instances per filename.
 */
const instances = new Map<string, LazyStore>();

function getStore(filename: string): LazyStore {
  let s = instances.get(filename);
  if (!s) {
    s = new LazyStore(filename, { defaults: {}, autoSave: 200 });
    instances.set(filename, s);
  }
  return s;
}

export function createTauriStorage(filename: string, _options?: unknown): IStorageAdapter {
  const store = getStore(filename);
  const changeCallbacks = new Set<
    (key: string, value: unknown) => void
  >();

  // LazyStore.onChange only fires within the writing process; we mirror
  // it through Tauri events for cross-webview support. The store-level
  // onChange is a best-effort supplement.
  //
  // The forwarder is re-registered on every onChange() subscribe so a
  // store whose underlying forwarder was reset (e.g. test setup clearing
  // the mock's onChange) is re-wired on the next subscription.
  let forwarderUnlisten: UnlistenFn | null = null;
  const ensureForwarder = () => {
    // Tear down the previous forwarder (prevents listener leaks) and
    // re-register so subscriptions always reach the current store.
    // The store's onChange may return a Promise<UnlistenFn>.
    forwarderUnlisten?.();
    forwarderUnlisten = null;
    const unlisten = store.onChange?.((key, value) => {
      for (const cb of changeCallbacks) {
        try {
          cb(key, value);
        } catch {
          // swallow
        }
      }
    });
    if (unlisten) {
      Promise.resolve(unlisten).then((u) => {
        forwarderUnlisten = u ?? null;
      });
    }
  };
  ensureForwarder();

  return {
    async init(_filename: string) {
      // LazyStore initializes on construction; this is a no-op.
    },

    async get<T = unknown>(key: string): Promise<T | undefined> {
      return (await store.get(key)) as T | undefined;
    },

    async set(key: string, value: unknown): Promise<void> {
      await store.set(key, value);
      await store.save();
    },

    async delete(key: string): Promise<void> {
      await store.delete(key);
      await store.save();
    },

    async entries(): Promise<[string, unknown][]> {
      return (await store.entries()) as [string, unknown][];
    },

    async save(): Promise<void> {
      await store.save();
    },

    onChange(callback: (key: string, value: unknown) => void): UnlistenFn {
      // Re-wire the underlying forwarder in case it was reset (tests).
      ensureForwarder();
      changeCallbacks.add(callback);
      return () => {
        changeCallbacks.delete(callback);
      };
    },
  };
}

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

// ---------------------------------------------------------------------------
// In-memory fallback for environments where the Tauri store plugin cannot run.
//
// Unit tests in the node/jsdom env reach `createStorage` (via module-load-time
// store creation such as `snippets.ts`). Two cases:
//  - Tests that `vi.mock("@tauri-apps/plugin-store")` supply a working fake
//    LazyStore (its get/set/save/onChange resolve without touching window) —
//    for those the plugin path succeeds and is used as-is.
//  - Tests that DON'T mock the plugin get a real LazyStore, whose operations
//    call `load()` -> `invoke` -> `window` (undefined) and reject. We must not
//    let those rejections become unhandled, and reads should return sensible
//    in-memory values.
//
// So: we always TRY the plugin first and only fall back to a per-file in-memory
// Map when the operation rejects. This keeps mocked tests on the real (mocked)
// path while making unmocked node tests safe.
// ---------------------------------------------------------------------------
const memFallbacks = new Map<string, Map<string, unknown>>();

function inMemoryBacking(filename: string): Map<string, unknown> {
  let m = memFallbacks.get(filename);
  if (!m) {
    m = new Map<string, unknown>();
    memFallbacks.set(filename, m);
  }
  return m;
}

export function createTauriStorage(filename: string, _options?: unknown): IStorageAdapter {
  const store = getStore(filename);
  const changeCallbacks = new Set<
    (key: string, value: unknown) => void
  >();
  const fallback = () => inMemoryBacking(filename);

  // LazyStore.onChange only fires within the writing process; we mirror
  // it through Tauri events for cross-webview support. The store-level
  // onChange is a best-effort supplement.
  //
  // The forwarder is re-registered on every onChange() subscribe so a
  // store whose underlying forwarder was reset (e.g. test setup clearing
  // the mock's onChange) is re-wired on the next subscription.
  let forwarderUnlisten: UnlistenFn | null = null;
  const ensureForwarder = () => {
    forwarderUnlisten?.();
    forwarderUnlisten = null;
    try {
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
        // onChange may return a Promise<UnlistenFn> (real plugin) or a sync
        // function (test mocks). Resolve either; a rejected promise (real
        // plugin in a non-Tauri env) must NOT become an unhandled rejection.
        Promise.resolve(unlisten)
          .then((u) => {
            forwarderUnlisten = u ?? null;
          })
          .catch(() => {
            // plugin rejected — leave forwarder unset; direct reads still work
          });
      }
    } catch {
      // onChange threw synchronously (no plugin) — degrade gracefully.
    }
  };

  return {
    async init(_filename: string) {
      // LazyStore initializes on construction; this is a no-op.
    },

    async get<T = unknown>(key: string): Promise<T | undefined> {
      try {
        return (await store.get(key)) as T | undefined;
      } catch {
        return fallback().get(key) as T | undefined;
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      try {
        await store.set(key, value);
        await store.save();
      } catch {
        fallback().set(key, value);
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await store.delete(key);
        await store.save();
      } catch {
        fallback().delete(key);
      }
    },

    async entries(): Promise<[string, unknown][]> {
      try {
        return (await store.entries()) as [string, unknown][];
      } catch {
        return Array.from(fallback().entries());
      }
    },

    async save(): Promise<void> {
      try {
        await store.save();
      } catch {
        // in-memory fallback — nothing to persist
      }
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

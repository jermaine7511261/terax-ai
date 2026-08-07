/**
 * Platform singleton accessor.
 *
 * Feature modules import from here:
 *   import { platform } from "@/platform";
 *   const data = await platform.ipc.invoke("some_command");
 *
 * The adapter is selected once at startup based on the runtime environment.
 * No feature code should import from `@tauri-apps/*` directly.
 */
import type { IPlatformAdapter, IStorageAdapter } from "./types";

let adapter: IPlatformAdapter | null = null;

/**
 * Detect the current runtime and return the appropriate adapter.
 * Called once during bootstrap; cached for the session.
 */
export async function detectPlatform(): Promise<IPlatformAdapter> {
  if (adapter) return adapter;

  // Tauri sets `window.__TAURI_INTERNALS__` before any user JS runs.
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  if (isTauri) {
    const { tauriAdapter } = await import("./tauri");
    adapter = tauriAdapter;
    return adapter;
  }

  // Fallback: no Tauri — use a minimal web stub (Phase 1+ will flesh this out).
  const { webAdapter } = await import("./web");
  adapter = webAdapter;
  return adapter;
}

/**
 * Synchronous accessor — use only after `detectPlatform()` has been called
 * during bootstrap. Throws if accessed before initialization.
 */
export function getPlatform(): IPlatformAdapter {
  if (!adapter) {
    throw new Error(
      "[platform] Not initialized. Call detectPlatform() first.",
    );
  }
  return adapter;
}

/**
 * Shorthand for the most common use case: invoke an IPC command.
 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (adapter) return adapter.ipc.invoke<T>(cmd, args);
  // Not initialized yet (bootstrap pending, or unit tests mocking the Tauri
  // invoke directly) — fall back to the raw Tauri invoke so existing mocked
  // tests keep working without calling detectPlatform() first.
  // Only pass args when present, so invoke("cmd") matches the single-arg form.
  return args === undefined
    ? tauriInvoke<T>(cmd)
    : tauriInvoke<T>(cmd, args as never);
}

/**
 * Raw-body invoke for latency-critical paths (PTY write, etc.).
 * Passes through to the platform's raw invoke if supported (Tauri); falls
 * back to JSON `invoke` on platforms without raw-body support.
 */
export function invokeRaw<T>(
  cmd: string,
  body: ArrayBuffer | Uint8Array,
  options?: { headers?: Record<string, string> },
): Promise<T> {
  if (adapter) {
    const p = adapter;
    if (p.ipc && "invokeRaw" in p.ipc && typeof (p.ipc as any).invokeRaw === "function") {
      return (p.ipc as any).invokeRaw(cmd, body, options);
    }
  }
  // Not initialized / no raw support: fall back to the raw Tauri invoke
  // (works in production Tauri and in tests that mock @tauri-apps/api/core).
  return tauriInvoke<T>(cmd, body, options as never);
}

/**
 * Create a storage adapter for a specific file.
 * Delegates to the active platform's storage factory if available,
 * otherwise creates a standalone storage instance.
 */
export function createStorage(filename: string, _options?: unknown): IStorageAdapter {
  const p = getPlatform();
  // If the platform exposes a factory, use it; otherwise fall back
  // to the default storage (settings).
  if ("createStorage" in p && typeof (p as any).createStorage === "function") {
    return (p as any).createStorage(filename);
  }
  // The default storage is already the right thing for single-store usage.
  return p.storage;
}

/** Re-export Channel type for files that use streaming IPC. */
import { Channel, convertFileSrc } from "@tauri-apps/api/core";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export { Channel, convertFileSrc };

export type { IPlatformAdapter, IStorageAdapter } from "./types";
export type * from "./types";

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
 * Subscribe to a cross-context event. Falls back to the raw Tauri listen
 * when the platform isn't initialized (unit tests mocking the event API).
 */
export function listen<T = unknown>(
  event: string,
  handler: (payload: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (adapter) return adapter.events.listen(event, handler);
  return tauriListen<T>(event, handler);
}

/** Emit a cross-context event. Falls back to the raw Tauri emit. */
export function emit(event: string, payload?: unknown): Promise<void> {
  if (adapter) return adapter.events.emit(event, payload);
  return payload === undefined ? tauriEmit(event) : tauriEmit(event, payload);
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
import {
  listen as tauriListen,
  emit as tauriEmit,
  type UnlistenFn,
} from "@tauri-apps/api/event";

export { Channel, convertFileSrc };
export type { UnlistenFn };

// ── P0-III: convenience adapters (opener / path / os / app / process /
// ── dialog / notification / autostart / updater / clipboard / window) ─────
// Each falls back to the raw Tauri call when the platform isn't initialized
// (unit tests, or before detectPlatform() runs) — same pattern as invoke().

import {
  openUrl as tauriOpenUrl,
  revealItemInDir as tauriRevealItemInDir,
} from "@tauri-apps/plugin-opener";
export function openUrl(url: string): Promise<void> {
  if (adapter) return adapter.opener.openUrl(url);
  return tauriOpenUrl(url);
}
export function revealItemInDir(path: string): Promise<void> {
  if (adapter) return adapter.opener.revealItemInDir(path);
  return tauriRevealItemInDir(path);
}

import {
  homeDir as tauriHomeDir,
  join as tauriJoin,
  appConfigDir as tauriAppConfigDir,
} from "@tauri-apps/api/path";
export function homeDir(): Promise<string> {
  if (adapter) return adapter.path.homeDir();
  return tauriHomeDir();
}
export function join(...paths: string[]): Promise<string> {
  if (adapter) return adapter.path.join(...paths);
  return tauriJoin(...paths);
}
export function appConfigDir(): Promise<string> {
  if (adapter) return adapter.path.appConfigDir();
  return tauriAppConfigDir();
}

import { platform as tauriOsPlatform, arch as tauriOsArch } from "@tauri-apps/plugin-os";
/** OS name (win32/darwin/linux…). Sync in Tauri, async elsewhere. */
export function getOsPlatform(): string {
  if (adapter) return adapter.os.platform() as unknown as string;
  return tauriOsPlatform();
}
export function getOsArch(): string {
  if (adapter) return adapter.os.arch() as unknown as string;
  return tauriOsArch();
}

import { getName as tauriGetName, getVersion as tauriGetVersion } from "@tauri-apps/api/app";
export function getAppName(): Promise<string> {
  if (adapter) return adapter.process.getName();
  return tauriGetName();
}
export function getAppVersion(): Promise<string> {
  if (adapter) return adapter.process.getVersion();
  return tauriGetVersion();
}

import { relaunch as tauriRelaunch } from "@tauri-apps/plugin-process";
export function relaunchApp(): Promise<void> {
  if (adapter) return adapter.process.relaunch();
  return tauriRelaunch();
}

import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
export function openDialog(
  options?: {
    title?: string;
    defaultPath?: string;
    directory?: boolean;
    multiple?: boolean;
    filters?: { name: string; extensions: string[] }[];
  },
): Promise<string | string[] | null> {
  if (adapter) return adapter.dialog.open(options as never);
  return tauriOpenDialog(options as never);
}

import {
  sendNotification as tauriSendNotification,
  isPermissionGranted as tauriIsPermGranted,
  requestPermission as tauriReqPerm,
} from "@tauri-apps/plugin-notification";
export function sendNotification(options: { title: string; body?: string }): void {
  if (adapter) return adapter.notification.sendNotification(options);
  return tauriSendNotification(options);
}
export function isNotificationGranted(): Promise<boolean> {
  if (adapter) return adapter.notification.isPermissionGranted();
  return tauriIsPermGranted();
}
export function requestNotificationPermission(): Promise<boolean> {
  if (adapter) return adapter.notification.requestPermission();
  return tauriReqPerm().then((p) => p === "granted");
}

import {
  enable as tauriAutostartEnable,
  disable as tauriAutostartDisable,
  isEnabled as tauriAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
export function autostartEnable(): Promise<void> {
  if (adapter) return adapter.autostart.enable();
  return tauriAutostartEnable();
}
export function autostartDisable(): Promise<void> {
  if (adapter) return adapter.autostart.disable();
  return tauriAutostartDisable();
}
export function autostartIsEnabled(): Promise<boolean> {
  if (adapter) return adapter.autostart.isEnabled();
  return tauriAutostartEnabled();
}

import { check as tauriUpdaterCheck } from "@tauri-apps/plugin-updater";
/** Re-export the full Tauri updater (incl. downloadAndInstall events). */
export { check, type Update } from "@tauri-apps/plugin-updater";
/** Adapter-based convenience check (returns null when unavailable). */
export function updaterCheck(): Promise<{
  available: boolean;
  update?: { version: string; date?: string; body?: string };
} | null> {
  if (adapter) return adapter.updater.check() as Promise<never>;
  return tauriUpdaterCheck();
}

import {
  readText as tauriClipboardRead,
  writeText as tauriClipboardWrite,
} from "@tauri-apps/plugin-clipboard-manager";
export function clipboardReadText(): Promise<string> {
  if (adapter) return adapter.clipboard.readText();
  return tauriClipboardRead();
}
export function clipboardWriteText(text: string): Promise<void> {
  if (adapter) return adapter.clipboard.writeText(text);
  return tauriClipboardWrite(text);
}

/**
 * Current window / webview.
 *
 * NOTE: these return the Tauri-native types directly (rather than the
 * IWindowAdapter) so existing call sites keep full type inference. The
 * window adapters (IWindowAdapter / IWebviewAdapter) remain available via
 * `getPlatform().window` for platform-agnostic code; the feature modules
 * that reach for the current window use the native object.
 */
export { getCurrentWindow } from "@tauri-apps/api/window";
export { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
export { getCurrentWebview } from "@tauri-apps/api/webview";

export type { IPlatformAdapter, IStorageAdapter } from "./types";
export type * from "./types";

import type { IPlatformAdapter } from "../types";
import { tauriIpc } from "./ipc";
import { createTauriStorage } from "./storage";
import { tauriEvents } from "./events";
import { tauriPath } from "./path";
import { tauriWindow } from "./window";
import { tauriWebview } from "./webview";
import { tauriOs } from "./os";
import { tauriDialog } from "./dialog";
import { tauriOpener } from "./opener";
import { tauriNotification } from "./notification";
import { tauriAutostart } from "./autostart";
import { tauriProcess } from "./process";
import { tauriUpdater } from "./updater";
import { tauriClipboard } from "./clipboard";
import { tauriWatch } from "./watch";

// Storage is per-file; expose a factory so callers get their own LazyStore.
// For the composite adapter, the default store is "yamet-settings.json".
const defaultStorage = createTauriStorage("yamet-settings.json");

export const tauriAdapter: IPlatformAdapter = {
  name: "tauri",
  ipc: tauriIpc,
  storage: defaultStorage,
  events: tauriEvents,
  path: tauriPath,
  window: tauriWindow,
  webview: tauriWebview,
  os: tauriOs,
  dialog: tauriDialog,
  opener: tauriOpener,
  notification: tauriNotification,
  autostart: tauriAutostart,
  process: tauriProcess,
  updater: tauriUpdater,
  clipboard: tauriClipboard,
  watch: tauriWatch,
};

/** Create a storage adapter for an arbitrary filename. */
export { createTauriStorage } from "./storage";

/** Re-export raw channel utilities for PTY bridge. */
export { createRawChannel, getRawChannel } from "./ipc";

/** Re-export Tauri Channel type for files that need it directly. */
export { Channel } from "@tauri-apps/api/core";

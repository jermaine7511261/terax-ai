/**
 * Web platform adapter — minimal stub for browser environments.
 * Phase 1+ will implement full functionality (WebSocket PTY, IndexedDB, etc.).
 */
import type { IPlatformAdapter } from "../types";
import { webIpc } from "./ipc";
import { webStorage } from "./storage";
import { webEvents } from "./events";
import { webPath } from "./path";
import { webWindow } from "./window";
import { webOs } from "./os";
import { webClipboard } from "./clipboard";
import { noopAdapter } from "./noop";

export const webAdapter: IPlatformAdapter = {
  name: "web",
  ipc: webIpc,
  storage: webStorage,
  events: webEvents,
  path: webPath,
  window: webWindow,
  webview: { ...noopAdapter.webview },
  os: webOs,
  dialog: noopAdapter.dialog,
  opener: noopAdapter.opener,
  notification: noopAdapter.notification,
  autostart: noopAdapter.autostart,
  process: noopAdapter.process,
  updater: noopAdapter.updater,
  clipboard: webClipboard,
  watch: noopAdapter.watch,
};

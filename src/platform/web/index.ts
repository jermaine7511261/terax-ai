/**
 * Web platform adapter — full implementation for browser environments.
 *
 * Architecture:
 * - IPC: WebSocket transport to a companion Node.js backend server
 *        (src/platform/web/server/) that bridges native file/shell/git ops.
 * - Storage: localStorage with StorageEvent-based onChange.
 * - Events: CustomEvent bus (same-tab).
 * - Window: Browser window management (fullscreen for maximize, etc.).
 * - Dialog: File System Access API / <input type="file"> fallback.
 * - Watch: Backend-pushed events via WebSocket + polling fallback.
 * - OS/Clipboard/Notification: Native browser APIs.
 */

import type { IPlatformAdapter } from "../types";
import { webIpc } from "./ipc";
import { createWebStorage, webStorage } from "./storage";
import { webEvents } from "./events";
import { webPath } from "./path";
import { webWindow } from "./window";
import { webOs } from "./os";
import { webClipboard } from "./clipboard";
import { webDialog } from "./dialog";
import { webWatch } from "./watch";
import { noopAdapter } from "./noop";

export const webAdapter: IPlatformAdapter = {
  name: "web",
  ipc: webIpc,
  storage: webStorage,
  createStorage: createWebStorage,
  events: webEvents,
  path: webPath,
  window: webWindow,
  webview: { ...noopAdapter.webview },
  os: webOs,
  dialog: webDialog,
  opener: noopAdapter.opener,
  notification: noopAdapter.notification,
  autostart: noopAdapter.autostart,
  process: noopAdapter.process,
  updater: noopAdapter.updater,
  clipboard: webClipboard,
  watch: webWatch,
};

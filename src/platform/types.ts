/**
 * Platform adapter interfaces — the single abstraction boundary between
 * YaMet's feature modules and the underlying runtime (Tauri desktop, web
 * browser, CLI, TUI).
 *
 * Every platform-specific capability flows through one of these interfaces.
 * Feature modules import from `@/platform` (the singleton accessor) and
 * never from `@tauri-apps/*` directly.
 */

// ── IPC ─────────────────────────────────────────────────────────────────────

/** Typed wrapper around the runtime's RPC/invoke mechanism. */
export interface IIpcAdapter {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;

  /**
   * Raw-body invoke for latency-critical paths. Tauri supports this natively;
   * other platforms may fall back or throw.
   */
  invokeRaw?<T>(
    cmd: string,
    body: ArrayBuffer | Uint8Array,
    options?: { headers?: Record<string, string> },
  ): Promise<T>;

  /**
   * Create a channel that the backend can stream data into.
   * Tauri: maps to `new Channel<T>()`.
   * Web:   maps to a ReadableStream or WebSocket-backed channel.
   */
  createChannel<T>(): StreamingChannel<T>;

  /** Convert an OS file path to a URL the webview can fetch. */
  convertFileSrc(path: string): string;
}

/** A unidirectional streaming channel from backend → frontend. */
export interface StreamingChannel<T> {
  /** Backend calls this to push data. */
  onmessage: (data: T) => void;
}

// ── Storage ─────────────────────────────────────────────────────────────────

/**
 * Persistent key-value storage.
 * Tauri: `@tauri-apps/plugin-store` LazyStore.
 * Web:   IndexedDB or localStorage.
 * CLI:   JSON file on disk.
 */
export interface IStorageAdapter {
  init(filename: string, options?: unknown): Promise<void>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  entries(): Promise<[string, unknown][]>;
  save(): Promise<void>;
  onChange(callback: (key: string, value: unknown) => void): () => void;
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Unlisten function returned by `listen()`. */
export type UnlistenFn = () => void;

/**
 * Cross-context event bus.
 * Tauri: `@tauri-apps/api/event` listen/emit.
 * Web:   BroadcastChannel or CustomEvent.
 */
export interface IEventAdapter {
  listen<T = unknown>(
    event: string,
    handler: (payload: { payload: T }) => void,
  ): Promise<UnlistenFn>;

  emit(event: string, payload: unknown): Promise<void>;
}

// ── Path ────────────────────────────────────────────────────────────────────

/**
 * File system path helpers.
 * Tauri: `@tauri-apps/api/path`.
 * Web:   No direct equivalent — returns sensible defaults or uses URL.
 */
export interface IPathAdapter {
  homeDir(): Promise<string>;
  join(...paths: string[]): Promise<string>;
  appConfigDir(): Promise<string>;
}

// ── Window ──────────────────────────────────────────────────────────────────

/**
 * Window management.
 * Tauri: `@tauri-apps/api/window`.
 * Web:   Wraps `window` / `document`.
 */
export interface IWindowAdapter {
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  setTitle(title: string): Promise<void>;
  isMaximized(): Promise<boolean>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMinimized(): Promise<boolean>;
  minimize(): Promise<void>;
  center(): Promise<void>;
  setResizable(resizable: boolean): Promise<void>;
  onResized(handler: (event: { payload: unknown }) => void): Promise<UnlistenFn>;
  onMoved(handler: (event: { payload: unknown }) => void): Promise<UnlistenFn>;
  onFocusedChanged(handler: (event: { payload: boolean }) => void): Promise<UnlistenFn>;
  /** Alias matching Tauri's native method name. */
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<UnlistenFn>;
  onCloseRequested(handler: (event: { payload: unknown }) => void): Promise<UnlistenFn>;
  /** Subscribe to an event on this window. */
  listen<T = unknown>(event: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn>;
  /** Subscribe to drag-drop events on this webview window. */
  onDragDropEvent(handler: (event: { payload: { type: string; paths: string[]; position: { x: number; y: number } } }) => void): Promise<UnlistenFn>;
  /** Focus this window. */
  setFocus(): Promise<void>;
}

/**
 * WebviewWindow management (for multi-window scenarios like settings).
 */
export interface IWebviewAdapter {
  getCurrentWebviewWindow(label: string): IWindowAdapter | null;
  /** Get the current webview instance. */
  getCurrentWebview(): IWindowAdapter | null;
}

// ── OS ──────────────────────────────────────────────────────────────────────

/**
 * Operating system detection.
 * Tauri: `@tauri-apps/plugin-os`.
 * Web:   navigator.userAgent parsing.
 */
export interface IOsAdapter {
  platform(): string;
  arch(): string;
}

// ── Dialog ──────────────────────────────────────────────────────────────────

/**
 * Native file/folder dialogs.
 * Tauri: `@tauri-apps/plugin-dialog`.
 * Web:   `<input type="file">` or File System Access API.
 */
export interface IDialogAdapter {
  open(options?: {
    title?: string;
    defaultPath?: string;
    directory?: boolean;
    multiple?: boolean;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | string[] | null>;
}

// ── Opener ──────────────────────────────────────────────────────────────────

/**
 * Open URLs or reveal files in the system file manager.
 * Tauri: `@tauri-apps/plugin-opener`.
 * Web:   `window.open()`.
 */
export interface IOpenerAdapter {
  openUrl(url: string): Promise<void>;
  revealItemInDir(path: string): Promise<void>;
}

// ── Notification ────────────────────────────────────────────────────────────

/**
 * System notifications.
 * Tauri: `@tauri-apps/plugin-notification`.
 * Web:   Web Notifications API.
 */
export interface INotificationAdapter {
  sendNotification(options: { title: string; body?: string }): void;
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

// ── Autostart ───────────────────────────────────────────────────────────────

/**
 * OS autostart / launch-at-login.
 * Tauri: `@tauri-apps/plugin-autostart`.
 * Web/CLI: no-op.
 */
export interface IAutostartAdapter {
  enable(): Promise<void>;
  disable(): Promise<void>;
  isEnabled(): Promise<boolean>;
}

// ── Process ─────────────────────────────────────────────────────────────────

/**
 * Process-level operations.
 * Tauri: `@tauri-apps/plugin-process` + `@tauri-apps/api/app`.
 * Web:   no-op or fallback.
 */
export interface IProcessAdapter {
  relaunch(): Promise<void>;
  exit(code?: number): Promise<void>;
  getName(): Promise<string>;
  getVersion(): Promise<string>;
}

// ── Updater ─────────────────────────────────────────────────────────────────

export interface IUpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

export interface IUpdateResult {
  available: boolean;
  update?: IUpdateInfo;
}

/**
 * Auto-update.
 * Tauri: `@tauri-apps/plugin-updater`.
 * Web/CLI: no-op.
 */
export interface IUpdaterAdapter {
  check(): Promise<IUpdateResult>;
}

// ── Clipboard ───────────────────────────────────────────────────────────────

/**
 * Clipboard read/write.
 * Tauri: `@tauri-apps/plugin-clipboard-manager`.
 * Web:   `navigator.clipboard`.
 */
export interface IClipboardAdapter {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

// ── Watch ───────────────────────────────────────────────────────────────────

/**
 * File system watcher.
 * Tauri: invoke("fs_watch_add") / invoke("fs_watch_remove"), events "fs:changed".
 * Web:   WebSocket-based or polling.
 */
export interface IWatchAdapter {
  watch(path: string, handler: (event: WatchEvent) => void): Promise<number>;
  unwatch(handle: number): Promise<void>;
}

export interface WatchEvent {
  kind: "create" | "modify" | "delete";
  paths: string[];
}

// ── Composite ───────────────────────────────────────────────────────────────

/**
 * The complete platform adapter bundle.
 * Each runtime (Tauri, web, CLI, TUI) provides one implementation of this.
 */
export interface IPlatformAdapter {
  readonly name: "tauri" | "web" | "cli" | "tui";
  readonly ipc: IIpcAdapter;
  readonly storage: IStorageAdapter;
  readonly createStorage?: (filename: string) => IStorageAdapter;
  readonly events: IEventAdapter;
  readonly path: IPathAdapter;
  readonly window: IWindowAdapter;
  readonly webview: IWebviewAdapter;
  readonly os: IOsAdapter;
  readonly dialog: IDialogAdapter;
  readonly opener: IOpenerAdapter;
  readonly notification: INotificationAdapter;
  readonly autostart: IAutostartAdapter;
  readonly process: IProcessAdapter;
  readonly updater: IUpdaterAdapter;
  readonly clipboard: IClipboardAdapter;
  readonly watch: IWatchAdapter;
}

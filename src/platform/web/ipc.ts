/**
 * WebSocket-based IPC adapter for web runtime.
 *
 * Architecture:
 * - Frontend connects to a backend WebSocket server
 * - invoke() sends `{id, cmd, args}` → backend routes to command handler → returns `{id, result}` or `{id, error}`
 * - Streaming: the backend pushes `{id, type:"chunk", data}` messages, frontend assembles them
 * - Reconnection: auto-reconnects with exponential backoff
 *
 * The backend server (src/platform/web/server/) is a separate Node.js process
 * that bridges IPC commands to native file system / shell / git operations.
 */

import type { IIpcAdapter, StreamingChannel } from "../types";

// ── Configuration ───────────────────────────────────────────────────────

/** Default WebSocket URL. Override via VITE_WS_URL env or runtime config. */
const WS_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_WS_URL) ||
  "ws://localhost:31219";

/**
 * Session token injected by `scripts/dev-web.mjs` (VITE_WS_TOKEN). The server
 * rejects every frame that does not carry it, so a malicious web page that
 * only knows the WS address cannot drive the backend. Empty string when the
 * frontend is served without the dev-web launcher (e.g. direct vite dev).
 */
const WS_TOKEN =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_WS_TOKEN) ||
  "";

const INVOKE_TIMEOUT_MS = 60_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

// ── WebSocket transport ─────────────────────────────────────────────────

type PendingInvoke = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type StreamChunk = {
  type: "chunk" | "end" | "error";
  data?: unknown;
  message?: string;
};

class WebSocketTransport {
  private ws: WebSocket | null = null;
  private url: string;
  private pending = new Map<string, PendingInvoke>();
  private streamListeners = new Map<string, (chunk: StreamChunk) => void>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /** Connect (or reuse existing connection). */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.establish();
    return this.connectPromise;
  }

  private async establish(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempt = 0;
          this.connectPromise = null;
          console.log(`[web-ipc] connected to ${this.url}`);
          resolve();
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(
              typeof ev.data === "string" ? ev.data : ev.data.toString(),
            );
            this.handleMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        };

        ws.onerror = (ev) => {
          console.warn("[web-ipc] websocket error", ev);
          this.connected = false;
          this.connectPromise = null;
          reject(new Error("WebSocket connection failed"));
        };

        ws.onclose = () => {
          this.connected = false;
          this.connectPromise = null;
          this.rejectAllPending("WebSocket closed");
          this.scheduleReconnect();
        };
      } catch (e) {
        this.connectPromise = null;
        reject(e);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  private rejectAllPending(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private handleMessage(
    msg: Record<string, unknown> & { id?: string },
  ): void {
    const { id } = msg;
    if (!id) return;

    // Stream chunk
    if (msg.type === "chunk" || msg.type === "end" || msg.type === "error") {
      const listener = this.streamListeners.get(id);
      if (listener) listener(msg as StreamChunk);
      if (msg.type === "end" || msg.type === "error") {
        this.streamListeners.delete(id);
      }
      return;
    }

    // Invoke response
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (msg.error) {
      pending.reject(new Error(String(msg.error)));
    } else {
      pending.resolve(msg.result);
    }
  }

  /** Send an invoke request and await the response. */
  async invoke<T>(cmd: string, args?: unknown): Promise<T> {
    await this.connect();
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`invoke("${cmd}") timed out after ${INVOKE_TIMEOUT_MS}ms`));
      }, INVOKE_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.ws?.send(JSON.stringify({ id, cmd, args, token: WS_TOKEN }));
    });
  }

  /** Register a stream listener for a given id (used by createChannel). */
  onStream(id: string, listener: (chunk: StreamChunk) => void): void {
    this.streamListeners.set(id, listener);
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

// ── Singleton transport ─────────────────────────────────────────────────

let transport: WebSocketTransport | null = null;

function getTransport(): WebSocketTransport {
  if (!transport) {
    transport = new WebSocketTransport(WS_URL);
  }
  return transport;
}

// ── IPC Adapter implementation ──────────────────────────────────────────

class WebIpcAdapter implements IIpcAdapter {
  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return getTransport().invoke<T>(cmd, args);
  }

  createChannel<T>(): StreamingChannel<T> {
    const id = crypto.randomUUID();
    const channel: StreamingChannel<T> = {
      onmessage: () => {},
    };

    // Tell the backend to start streaming to this channel id.
    getTransport().onStream(id, (chunk) => {
      if (chunk.type === "chunk" && chunk.data !== undefined) {
        channel.onmessage(chunk.data as T);
      }
    });

    // Register the channel with the backend (it will push chunks with this id).
    getTransport()
      .invoke("__register_channel", { channelId: id })
      .catch(() => {});

    return channel;
  }

  convertFileSrc(path: string): string {
    // In web mode, file paths are proxied through the backend.
    // The backend serves file content at /api/file/<encoded-path>.
    const encoded = encodeURIComponent(path);
    return `/api/file/${encoded}`;
  }
}

export const webIpc: IIpcAdapter = new WebIpcAdapter();

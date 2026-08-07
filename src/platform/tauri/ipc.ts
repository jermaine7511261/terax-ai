import { Channel, invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import type { IIpcAdapter, StreamingChannel } from "../types";

class TauriStreamingChannel<T> implements StreamingChannel<T> {
  private channel: Channel<T>;

  constructor() {
    this.channel = new Channel<T>();
  }

  get onmessage(): (data: T) => void {
    return this.channel.onmessage;
  }

  set onmessage(fn: (data: T) => void) {
    this.channel.onmessage = fn;
  }

  /** Expose the raw Tauri Channel for invoke() calls that need it. */
  get raw(): Channel<T> {
    return this.channel;
  }
}

export const tauriIpc: IIpcAdapter = {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return invoke<T>(cmd, args as InvokeArgs | undefined);
  },

  /**
   * Raw-body invoke for latency-critical paths (PTY write). Calls the
   * underlying Tauri invoke() with Uint8Array body + headers.
   */
  async invokeRaw<T>(
    cmd: string,
    body: ArrayBuffer | Uint8Array,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    return invoke<T>(cmd, body, options as any);
  },

  createChannel<T>(): StreamingChannel<T> {
    return new TauriStreamingChannel<T>();
  },

  convertFileSrc(path: string): string {
    return tauriConvertFileSrc(path);
  },
};

/** Access the raw Tauri Channel for advanced use (PTY bridge). */
export function createRawChannel<T>(): Channel<T> {
  return new Channel<T>();
}

/** Check if a StreamingChannel is a Tauri channel and get the raw one. */
export function getRawChannel<T>(ch: StreamingChannel<T>): Channel<T> {
  return (ch as TauriStreamingChannel<T>).raw;
}

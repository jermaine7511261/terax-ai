import type { IIpcAdapter, StreamingChannel } from "../types";

class WebChannel<T> implements StreamingChannel<T> {
  private _handler: (data: T) => void = () => {};

  get onmessage(): (data: T) => void {
    return this._handler;
  }

  set onmessage(fn: (data: T) => void) {
    this._handler = fn;
  }

  /** Simulate backend → frontend push (for testing/demo). */
  push(data: T) {
    this._handler(data);
  }
}

export const webIpc: IIpcAdapter = {
  async invoke<T>(_cmd: string, _args?: Record<string, unknown>): Promise<T> {
    console.warn(`[platform/web] invoke("${_cmd}") — not implemented`);
    return undefined as T;
  },

  createChannel<T>(): StreamingChannel<T> {
    return new WebChannel<T>();
  },

  convertFileSrc(path: string): string {
    // Web can't convert OS paths; return as-is or use fetch proxy.
    return path;
  },
};

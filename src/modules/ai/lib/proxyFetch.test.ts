import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { createProxyFetch, proxyFetch } from "./proxyFetch";

const mockInvoke = vi.mocked(invoke);

type StreamArgs = {
  url?: string;
  method?: string;
  body?: number[];
  headers?: Record<string, string>;
  allowPrivateNetwork?: boolean;
  onEvent?: unknown;
};

const lastArg = () => mockInvoke.mock.calls[0]?.[1] as unknown as StreamArgs;

class FakeChannel {
  onmessage: ((event: unknown) => void) | null = null;
}

function lastChannel(): FakeChannel {
  const arg = mockInvoke.mock.calls[0]?.[1] as { onEvent: FakeChannel };
  return arg.onEvent;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function feed(kind: string, payload?: Record<string, unknown>) {
  await flush();
  lastChannel().onmessage?.({ kind, ...payload });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createProxyFetch", () => {
  it("returns a callable fetch function", () => {
    const f = createProxyFetch();
    expect(typeof f).toBe("function");
    expect(typeof proxyFetch).toBe("function");
  });
});

describe("proxyFetch streaming over invoke", () => {
  it("resolves the response on headers and streams chunks to a text body", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const res = proxyFetch("https://api.example.com/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    await feed("headers", { status: 200, headers: { "content-type": "text/plain" } });
    await feed("chunk", { bytes: Array.from(new TextEncoder().encode("hel")) });
    await feed("chunk", { bytes: Array.from(new TextEncoder().encode("lo")) });
    await feed("end");

    const r = await res;
    expect(r.status).toBe(200);
    await expect(r.text()).resolves.toBe("hello");

    expect(mockInvoke).toHaveBeenCalledWith("ai_http_stream", {
      url: "https://api.example.com/v1/chat",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Array.from(new TextEncoder().encode("{}")),
      allowPrivateNetwork: false,
      onEvent: expect.anything(),
    });
  });

  it("resolves a URL object to its string form and defaults the method to GET", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const p = proxyFetch(new URL("https://example.com/stream"));
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    const arg = lastArg();
    expect(arg.url).toBe("https://example.com/stream");
    expect(arg.method).toBe("GET");
    expect(arg.body).toBeUndefined();
    expect(arg.headers).toBeUndefined();
  });

  it("rejects when an error event arrives before headers", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const p = proxyFetch("https://example.com");
    await feed("error", { message: "upstream 500" });
    await expect(p).rejects.toThrow("upstream 500");
  });

  it("rejects when invoke itself fails before headers", async () => {
    mockInvoke.mockRejectedValue(new Error("invoke failed"));
    await expect(proxyFetch("https://example.com")).rejects.toThrow("invoke failed");
  });

  it("throws an AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      proxyFetch("https://example.com", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates an abort via the signal listener before resolution", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const controller = new AbortController();
    const p = proxyFetch("https://example.com", { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("converts headers from a Headers instance", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const h = new Headers({ "x-test": "1", "x-other": "2" });
    const p = proxyFetch("https://example.com", { method: "GET", headers: h });
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    expect(lastArg().headers).toEqual({ "x-test": "1", "x-other": "2" });
  });

  it("converts headers from an array of tuples", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const p = proxyFetch("https://example.com", {
      headers: [
        ["a", "1"],
        ["b", "2"],
      ],
    });
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    expect(lastArg().headers).toEqual({ a: "1", b: "2" });
  });

  it("converts a stringified body value to bytes", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const p = proxyFetch("https://example.com", { method: "POST", body: "abc" });
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    expect(lastArg().body).toEqual([97, 98, 99]);
  });

  it("converts an ArrayBuffer body to bytes", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const buf = new TextEncoder().encode("xy").buffer;
    const p = proxyFetch("https://example.com", { method: "POST", body: buf });
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    expect(lastArg().body).toEqual([120, 121]);
  });

  it("converts a typed-array body to bytes", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const view = new Uint8Array([1, 2, 3]);
    const p = proxyFetch("https://example.com", { method: "POST", body: view });
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    expect(lastArg().body).toEqual([1, 2, 3]);
  });

  it("streams the response when allowPrivateNetwork is enabled", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const f = createProxyFetch({ allowPrivateNetwork: true });
    const p = f("https://example.com");
    await feed("headers", { status: 200, headers: {} });
    await feed("end");
    await p;
    expect(lastArg().allowPrivateNetwork).toBe(true);
  });
});

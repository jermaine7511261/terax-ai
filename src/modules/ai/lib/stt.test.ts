import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROVIDER_KEYS } from "./keyring";
import { transcribeAudio } from "./stt";

function installAudioContext() {
  class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    closed = false;
    constructor() {
      FakeAudioContext.instances.push(this);
    }
    async decodeAudioData() {
      return {
        length: 4,
        sampleRate: 8000,
        getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
      };
    }
    close() {
      this.closed = true;
    }
  }
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  return FakeAudioContext;
}

let FakeAudioContext: ReturnType<typeof installAudioContext> | null = null;

beforeEach(() => {
  FakeAudioContext = installAudioContext();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).AudioContext;
});

function audioBlob(): Blob {
  return new Blob([new Uint8Array(16)], { type: "audio/webm" });
}

describe("transcribeAudio (whispercpp)", () => {
  it("transcribes via the loopback /inference endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("hello world", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await transcribeAudio(audioBlob(), "whispercpp", EMPTY_PROVIDER_KEYS, {});

    expect(text).toBe("hello world");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8080/inference");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.signal).toBeDefined();
    expect(FakeAudioContext!.instances[0].closed).toBe(true);
  });

  it("uses the configured base URL stripped of trailing slashes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeAudio(audioBlob(), "whispercpp", EMPTY_PROVIDER_KEYS, {
      whispercppBaseURL: "http://localhost:9000/",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9000/inference");
  });

  it("rejects a non-loopback host to keep audio local", async () => {
    await expect(
      transcribeAudio(audioBlob(), "whispercpp", EMPTY_PROVIDER_KEYS, {
        whispercppBaseURL: "https://cloud.example.com",
      }),
    ).rejects.toThrow(/loopback/);
  });

  it("rejects an invalid base URL", async () => {
    await expect(
      transcribeAudio(audioBlob(), "whispercpp", EMPTY_PROVIDER_KEYS, {
        whispercppBaseURL: "not a url",
      }),
    ).rejects.toThrow(/Invalid Whisper.cpp URL/);
  });

  it("throws with the status when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("boom", { status: 500, statusText: "Server Error" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      transcribeAudio(audioBlob(), "whispercpp", EMPTY_PROVIDER_KEYS, {}),
    ).rejects.toThrow("STT request failed (500)");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));

import { openPty, type PtySession } from "./pty-bridge";

const CHUNK = 32 * 1024;

function ptyWriteCalls() {
  return invoke.mock.calls
    .filter((c) => c[0] === "pty_write")
    .map((c) => c[1] as Uint8Array);
}

async function openSession(): Promise<PtySession> {
  invoke.mockResolvedValueOnce(1);
  return openPty(80, 24, { onData: vi.fn() }, "/repo");
}

describe("pty-bridge write chunking", () => {
  beforeEach(() => {
    invoke.mockClear();
  });

  it("passes a small write through as a single chunk", async () => {
    const session = await openSession();
    await session.write("echo hi\n");

    const writes = ptyWriteCalls();
    expect(writes).toHaveLength(1);
    expect(new TextDecoder().decode(writes[0])).toBe("echo hi\n");
    expect(writes[0].length).toBeLessThanOrEqual(CHUNK);
  });

  it("splits a large payload into 32KiB chunks plus a trailing partial", async () => {
    const session = await openSession();
    const payload = "x".repeat(CHUNK * 3 + 1696); // 100000 bytes
    await session.write(payload);

    const writes = ptyWriteCalls();
    expect(writes).toHaveLength(4);
    // Three full chunks and one trailing partial.
    expect(writes[0].length).toBe(CHUNK);
    expect(writes[1].length).toBe(CHUNK);
    expect(writes[2].length).toBe(CHUNK);
    expect(writes[3].length).toBe(1696);
  });

  it("preserves the total byte count across chunks", async () => {
    const session = await openSession();
    const payload = "z".repeat(70_000);
    await session.write(payload);

    const writes = ptyWriteCalls();
    const total = writes.reduce((sum, w) => sum + w.length, 0);
    expect(total).toBe(70_000);
    // Concatenated bytes match the original payload exactly.
    const merged = new Uint8Array(total);
    let off = 0;
    for (const w of writes) {
      merged.set(w, off);
      off += w.length;
    }
    expect(new TextDecoder().decode(merged)).toBe(payload);
  });

  it("yields to the event loop between chunks (awaits each write)", async () => {
    const session = await openSession();

    // Hold every pty_write behind one gate so the chunk loop blocks on await.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let chunkCalls = 0;
    invoke.mockImplementation(async (cmd: unknown) => {
      if (cmd === "pty_write") {
        chunkCalls++;
        await gate;
      }
      return undefined;
    });

    const pending = session.write("y".repeat(CHUNK * 2 + 10));

    // Before the gate opens, only the first chunk is issued — proving write()
    // awaits between chunk invokes rather than firing all of them at once.
    expect(chunkCalls).toBe(1);

    release();
    await pending;
    expect(chunkCalls).toBe(3);
  });
});

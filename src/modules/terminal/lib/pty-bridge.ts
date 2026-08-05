import type { SshTarget } from "@/modules/tabs";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";

const textEncoder = new TextEncoder();

export type PtyHandlers = {
  onData: (bytes: Uint8Array) => void;
  onExit?: (code: number) => void;
};

export type PtySession = {
  id: number;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
};

export async function openPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  shell?: string,
  ssh?: SshTarget,
): Promise<PtySession> {
  // SSH sessions and the helper path are mutually exclusive for now (the
  // helper does not host ssh clients); keep ssh on the in-process path.
  if (!ssh) {
    try {
      return await openPtyViaHelper(cols, rows, handlers, cwd, blocks, shell);
    } catch (e) {
      console.warn("[yamet] pty helper unavailable, falling back:", e);
    }
  }
  return openPtyInProcess(cols, rows, handlers, cwd, blocks, shell, ssh);
}

/** Attach to an existing helper session (restored cold tab with a ptyId). */
export async function attachPty(
  id: number,
  handlers: PtyHandlers,
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();
  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };
  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };
  await invoke("pty_helper_attach", { id, onData, onExit });
  let closed = false;
  const headers = { "x-pty-id": String(id) };
  return {
    id,
    write: async (data) => {
      const bytes = textEncoder.encode(data);
      await invoke("pty_helper_write", bytes, { headers });
    },
    resize: (c, r) => invoke("pty_helper_resize", { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_helper_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

// The helper hosts the PTY in a detached process, so a main-process crash no
// longer kills the shell; the session survives for a later attach.
async function openPtyViaHelper(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  shell?: string,
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();
  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };
  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };
  const id = await invoke<number>("pty_helper_open", {
    cols,
    rows,
    cwd: cwd ?? null,
    workspace: currentWorkspaceEnv(),
    blocks: blocks ?? false,
    shell: shell ?? null,
    onData,
    onExit,
  });
  let closed = false;
  const headers = { "x-pty-id": String(id) };
  const WRITE_CHUNK_BYTES = 32 * 1024;
  return {
    id,
    write: async (data) => {
      const bytes = textEncoder.encode(data);
      if (bytes.length <= WRITE_CHUNK_BYTES) {
        await invoke("pty_helper_write", bytes, { headers });
        return;
      }
      for (let i = 0; i < bytes.length; i += WRITE_CHUNK_BYTES) {
        const chunk = bytes.subarray(i, i + WRITE_CHUNK_BYTES);
        await invoke("pty_helper_write", chunk, { headers });
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    },
    resize: (c, r) => invoke("pty_helper_resize", { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_helper_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

async function openPtyInProcess(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
  cwd?: string,
  blocks?: boolean,
  shell?: string,
  ssh?: SshTarget,
): Promise<PtySession> {
  // Raw bytes — no base64/JSON round-trip; messages arrive as ArrayBuffer.
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();

  let released = false;
  const noop = () => {};
  const releaseHandlers = () => {
    if (released) return;
    released = true;
    onData.onmessage = noop;
    onExit.onmessage = noop;
  };

  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));
  onExit.onmessage = (code) => {
    handlers.onExit?.(code);
    releaseHandlers();
  };

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd: cwd ?? null,
    workspace: currentWorkspaceEnv(),
    blocks: blocks ?? false,
    shell: shell ?? null,
    ssh: ssh ?? null,
    onData,
    onExit,
  });

  let closed = false;
  const headers = { "x-pty-id": String(id) };

  // Split very large writes (paste of a big file/log) into bounded chunks so a
  // single multi-MB IPC payload can't stall the renderer or overflow a backend
  // buffer. Small writes pass through in one call (no per-keystroke cost).
  const WRITE_CHUNK_BYTES = 32 * 1024;

  return {
    id,
    // Raw bytes + id header: no JSON round-trip on the per-keystroke path.
    write: async (data) => {
      const bytes = textEncoder.encode(data);
      if (bytes.length <= WRITE_CHUNK_BYTES) {
        await invoke("pty_write", bytes, { headers });
        return;
      }
      // Large payload: chunk + yield to the event loop between writes so the
      // UI thread stays responsive and the backend flushes progressively.
      for (let i = 0; i < bytes.length; i += WRITE_CHUNK_BYTES) {
        const chunk = bytes.subarray(i, i + WRITE_CHUNK_BYTES);
        await invoke("pty_write", chunk, { headers });
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    },
    resize: (c, r) => invoke("pty_resize", { id, cols: c, rows: r }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_close", { id });
      } finally {
        releaseHandlers();
      }
    },
  };
}

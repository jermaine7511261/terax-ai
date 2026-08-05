// DAP debugger frontend client: bridges to the Rust `dap_*` commands and
// normalizes inbound frames into typed events. The panel owns its model
// (state/threads/frames/variables) and updates it from these events; this
// module stays a thin transport wrapper (mirrors the LSP split).

import { Channel, invoke } from "@tauri-apps/api/core";

export type DebugEvent =
  | { kind: "event"; method: string; params: unknown }
  | { kind: "reverse_request"; id: number; method: string; params: unknown }
  | { kind: "response"; requestSeq: number; body: unknown }
  | { kind: "exit"; code: number | null };

export type DebugLaunchConfig = {
  program: string;
  cwd?: string;
  adapter?: string;
  args?: Record<string, unknown>;
  attach?: boolean;
};

export type DebugHandle = {
  id: number;
  /** Send an arbitrary DAP message to the adapter. */
  send: (message: unknown) => Promise<void>;
  kill: () => Promise<void>;
  /** Request a thread list. */
  threads: () => Promise<void>;
  /** Request the call stack for a stopped thread. */
  stackTrace: (threadId: number) => Promise<void>;
  /** Request scopes for a stack frame id. */
  scopes: (frameId: number) => Promise<void>;
  /** Request variables for a scope/frame. */
  variables: (variablesReference: number) => Promise<void>;
  /** Continue / pause / step. */
  continue_: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => Promise<void>;
  stepIn: () => Promise<void>;
  stepOut: () => Promise<void>;
  /** Evaluate an expression in the active frame. */
  evaluate: (expression: string) => Promise<string>;
};

/** Parse a raw inbound byte buffer into a DebugEvent (best-effort). */
export function parseInbound(
  buf: ArrayBuffer,
): DebugEvent | null {
  try {
    const msg = JSON.parse(new TextDecoder().decode(buf)) as {
      kind?: string;
      method?: string;
      params?: unknown;
      id?: number;
      request_seq?: number;
      body?: unknown;
    };
    if (msg.kind === "event") {
      return { kind: "event", method: msg.method ?? "", params: msg.params };
    }
    if (msg.kind === "response") {
      return {
        kind: "response",
        requestSeq: msg.request_seq ?? msg.id ?? 0,
        body: msg.body ?? {},
      };
    }
    if (msg.kind === "reverse_request") {
      return {
        kind: "reverse_request",
        id: msg.id ?? 0,
        method: msg.method ?? "",
        params: msg.params,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Launch or attach a debug session. `onEvent` fires for every inbound frame
 * and the terminal exit. Returns a handle for driving the session.
 */
export async function debugLaunch(
  config: DebugLaunchConfig,
  onEvent: (e: DebugEvent) => void,
): Promise<DebugHandle> {
  const onInbound = new Channel<ArrayBuffer>();
  const onExit = new Channel<{ code: number | null }>();

  onInbound.onmessage = (buf) => {
    const ev = parseInbound(buf);
    if (ev) {
      // Adapt the flow to debugpy's deferred-launch semantics: `launch`'s
      // response only arrives after `configurationDone`, which we send once
      // the adapter emits `initialized`.
      if (ev.kind === "event" && ev.method === "initialized") {
        void send({
          type: "request",
          seq: 2,
          command: "configurationDone",
          arguments: {},
        });
      }
      onEvent(ev);
    }
  };
  onExit.onmessage = (e) => {
    onEvent({ kind: "exit", code: e.code });
  };

  const cmd = config.attach ? "dap_attach" : "dap_launch";
  const id = await invoke<number>(cmd, {
    config: {
      program: config.program,
      cwd: config.cwd ?? null,
      adapter: config.adapter ?? null,
      args: config.args ?? {},
      attach: config.attach ?? false,
    },
    onInbound,
    onExit,
  });

  const send = (message: unknown) =>
    invoke("dap_send", { id, message }).then(() => undefined);

  return {
    id,
    send,
    kill: async () => {
      await invoke("dap_kill", { id });
    },
    threads: async () => {
      await send({ type: "request", seq: Date.now() % 100000, command: "threads" });
    },
    stackTrace: async (threadId) => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "stackTrace",
        arguments: { threadId },
      });
    },
    scopes: async (frameId) => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "scopes",
        arguments: { frameId },
      });
    },
    variables: async (variablesReference) => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "variables",
        arguments: { variablesReference },
      });
    },
    continue_: async () => {
      await send({ type: "request", seq: Date.now() % 100000, command: "continue", arguments: {} });
    },
    pause: async () => {
      await send({ type: "request", seq: Date.now() % 100000, command: "pause" });
    },
    next: async () => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "next",
        arguments: { threadId: 1 },
      });
    },
    stepIn: async () => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "stepIn",
        arguments: { threadId: 1 },
      });
    },
    stepOut: async () => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "stepOut",
        arguments: { threadId: 1 },
      });
    },
    evaluate: async (expression) => {
      await send({
        type: "request",
        seq: Date.now() % 100000,
        command: "evaluate",
        arguments: { expression, context: "repl" },
      });
      return "";
    },
  };
}

/** Parsed `threads` response body. */
export type ThreadsBody = { threads?: { id: number; name: string }[] };
/** Parsed `stackTrace` response body. */
export type StackTraceBody = {
  stackFrames?: {
    id: number;
    name: string;
    source?: { path?: string; name?: string };
    line: number;
    column: number;
  }[];
};
/** Parsed `variables` response body. */
export type VariablesBody = {
  variables?: {
    name: string;
    value: string;
    type?: string;
    variablesReference?: number;
  }[];
};

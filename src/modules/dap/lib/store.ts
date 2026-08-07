import { Channel } from "@/platform";
import { listen } from "@/platform";
import { create } from "zustand";
import {
  dapRequestSend,
  dapSessionConnect,
  dapSessionCreate,
  dapSessionDisconnect,
  dapSessionList,
  type DapEvent,
  type DapSessionConfig,
  type DapSessionInfo,
} from "./api";

export type StackFrame = {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { name?: string; path?: string };
};

export type Variable = {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  indexedVariables?: number;
};

export type ConsoleLine = {
  id: number;
  category: string;
  text: string;
};

type DapStatusEvent = {
  sessionId: string;
  status: DapSessionInfo["status"];
  error?: string | null;
};

type DapStore = {
  sessions: DapSessionInfo[];
  loaded: boolean;
  activeSessionId: string | null;
  threads: { id: number; name: string }[];
  activeThreadId: number | null;
  frames: StackFrame[];
  variables: Variable[];
  output: ConsoleLine[];
  nextOutputId: number;
  breakpoints: Record<string, number[]>;
  launchArgs: string;
  busy: boolean;

  refresh: () => Promise<void>;
  createSession: (config: DapSessionConfig) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
  start: (id: string, root: string | null) => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  continueRun: () => Promise<void>;
  step: (kind: "next" | "stepIn" | "stepOut") => Promise<void>;
  selectThread: (id: number) => Promise<void>;
  selectFrame: (frameId: number) => Promise<void>;
  toggleBreakpoint: (path: string, line: number) => void;
  clearOutput: () => void;
  setLaunchArgs: (json: string) => void;
  hide: () => void;

  send: (
    command: string,
    args?: Record<string, unknown> | null,
  ) => Promise<DapResponseLike>;
};

type DapResponseLike = {
  success: boolean;
  message?: string;
  body?: Record<string, unknown>;
};

const DEFAULT_LAUNCH_ARGS = JSON.stringify({ program: "build/app" }, null, 2);

function responseMessage(resp: DapResponseLike): string {
  return resp.success ? "" : (resp.message ?? "adapter error");
}

const eventChannels: Map<string, Channel<DapEvent>> = new Map();
let statusUnlisten: Promise<() => void> | null = null;

function wireStatusBridge(): void {
  if (statusUnlisten) return;
  statusUnlisten = listen<DapStatusEvent>("yamet:dap-status", (e) => {
    const s = useDapStore.getState();
    const evt = e.payload;
    s.refresh().then(() => {
      if (evt.status === "error" && s.activeSessionId === evt.sessionId) {
        useDapStore.setState({ busy: false });
      }
    });
  });
}

function handleDapEvent(_sessionId: string, evt: DapEvent): void {
  const s = useDapStore.getState();
  switch (evt.event) {
    case "initialized": {
      // Adapter is ready: send launch (or attach) then configurationDone.
      void (async () => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(s.launchArgs || "{}");
        } catch {
          args = {};
        }
        const launch = await s.send("launch", args);
        const err = responseMessage(launch);
        if (err) {
          useDapStore.setState((st) => {
            const line: ConsoleLine = { id: st.nextOutputId, category: "stderr", text: `launch failed: ${err}\n` };
            return { output: [...st.output, line], nextOutputId: st.nextOutputId + 1 };
          });
          return;
        }
        await s.send("configurationDone", null);
        useDapStore.setState({ busy: false });
      })();
      return;
    }
    case "stopped": {
      useDapStore.setState({ busy: false });
      void refreshDebugState(_sessionId);
      return;
    }
    case "continued": {
      useDapStore.setState({ busy: false, frames: [], variables: [] });
      return;
    }
    case "output": {
      const body = evt.body ?? {};
      const category = String(body.category ?? "console");
      const text = String(body.output ?? "");
      useDapStore.setState((st) => {
        const line: ConsoleLine = { id: st.nextOutputId, category, text };
        return {
          output: [...st.output.slice(-500), line],
          nextOutputId: st.nextOutputId + 1,
        };
      });
      return;
    }
    case "exited":
    case "terminated": {
      useDapStore.setState({ busy: false, threads: [], frames: [], variables: [] });
      void useDapStore.getState().refresh();
      return;
    }
    default:
      break;
  }
}

async function refreshDebugState(_sessionId: string): Promise<void> {
  const s = useDapStore.getState();
  const threadsResp = await s.send("threads");
  const threads: { id: number; name: string }[] =
    (threadsResp.body?.threads as { id: number; name: string }[] | undefined) ?? [];
  useDapStore.setState({ threads });
  if (threads.length === 0) return;
  const threadId = s.activeThreadId ?? threads[0].id;
  useDapStore.setState({ activeThreadId: threadId });
  const stackResp = await s.send("stackTrace", { threadId, maxLevels: 50 });
  const frames: StackFrame[] =
    (stackResp.body?.stackFrames as StackFrame[] | undefined) ?? [];
  useDapStore.setState({ frames });
  if (frames.length > 0) {
    await useDapStore.getState().selectFrame(frames[0].id);
  }
}

export const useDapStore = create<DapStore>((set, get) => ({
  sessions: [],
  loaded: false,
  activeSessionId: null,
  threads: [],
  activeThreadId: null,
  frames: [],
  variables: [],
  output: [],
  nextOutputId: 1,
  breakpoints: {},
  launchArgs: DEFAULT_LAUNCH_ARGS,
  busy: false,

  refresh: async () => {
    const sessions = await dapSessionList();
    set({ sessions, loaded: true });
  },

  createSession: async (config) => {
    await dapSessionCreate(config);
    await get().refresh();
  },

  removeConfig: async (id) => {
    const s = get();
    if (s.sessions.find((x) => x.id === id)?.status !== "inactive") {
      try {
        await dapSessionDisconnect(id);
      } catch {
        // session may already be gone
      }
    }
    // Config removal is done through the backend's create-only registry; we
    // keep the entry but it stays inactive.
    await get().refresh();
  },

  start: async (id, root) => {
    wireStatusBridge();
    const existing = get().sessions.find((x) => x.id === id);
    if (existing?.status !== "inactive") {
      try {
        await dapSessionDisconnect(id);
      } catch {
        // ignore
      }
    }
    const channel = new Channel<DapEvent>();
    channel.onmessage = (evt) => handleDapEvent(id, evt);
    eventChannels.set(id, channel);
    set({ activeSessionId: id, output: [], threads: [], frames: [], variables: [], busy: true });
    try {
      await dapSessionConnect(id, root, null, channel);
      await get().refresh();
    } catch (e) {
      set((st) => {
        const line: ConsoleLine = { id: st.nextOutputId, category: "stderr", text: `connect failed: ${String(e)}\n` };
        return {
          busy: false,
          output: [...st.output, line],
          nextOutputId: st.nextOutputId + 1,
        };
      });
    }
  },

  stop: async () => {
    const id = get().activeSessionId;
    if (!id) return;
    try {
      await dapSessionDisconnect(id);
    } catch {
      // ignore
    }
    set({ busy: false, threads: [], frames: [], variables: [] });
    await get().refresh();
  },

  pause: async () => {
    const s = get();
    if (!s.activeSessionId) return;
    set({ busy: true });
    const resp = await s.send("pause");
    if (responseMessage(resp)) set({ busy: false });
  },

  continueRun: async () => {
    const s = get();
    if (!s.activeSessionId || s.activeThreadId == null) return;
    set({ busy: true });
    const resp = await s.send("continue", { threadId: s.activeThreadId });
    if (responseMessage(resp)) set({ busy: false });
  },

  step: async (kind) => {
    const s = get();
    if (!s.activeSessionId || s.activeThreadId == null) return;
    set({ busy: true });
    const resp = await s.send(kind, { threadId: s.activeThreadId });
    if (responseMessage(resp)) set({ busy: false });
  },

  selectThread: async (id) => {
    const s = get();
    set({ activeThreadId: id });
    const stackResp = await s.send("stackTrace", { threadId: id, maxLevels: 50 });
    const frames = (stackResp.body?.stackFrames as StackFrame[] | undefined) ?? [];
    set({ frames });
    if (frames.length > 0) await get().selectFrame(frames[0].id);
  },

  selectFrame: async (frameId) => {
    const s = get();
    const scopesResp = await s.send("scopes", { frameId });
    const scopes = (scopesResp.body?.scopes as { variablesReference: number }[] | undefined) ?? [];
    const scope = scopes[0];
    if (!scope) {
      set({ variables: [] });
      return;
    }
    const varsResp = await s.send("variables", { variablesReference: scope.variablesReference });
    const variables = (varsResp.body?.variables as Variable[] | undefined) ?? [];
    set({ variables });
  },

  toggleBreakpoint: (path, line) => {
    const s = get();
    const current = s.breakpoints[path] ?? [];
    const next = current.includes(line)
      ? current.filter((l) => l !== line)
      : [...current, line].sort((a, b) => a - b);
    set((st) => ({ breakpoints: { ...st.breakpoints, [path]: next } }));
    const id = s.activeSessionId;
    if (!id) return;
    // Push the new breakpoint set to the active adapter for this file.
    void dapRequestSend(id, "setBreakpoints", {
      source: { path, name: path.split(/[\\/]/).pop() ?? path },
      breakpoints: next.map((l) => ({ line: l })),
    }).catch(() => {});
  },

  clearOutput: () => set({ output: [] }),

  setLaunchArgs: (json) => set({ launchArgs: json }),

  hide: () => set({ activeSessionId: null }),

  send: (command, args) => {
    const id = get().activeSessionId;
    if (!id) return Promise.reject(new Error("no active debug session"));
    return dapRequestSend(id, command, args ?? null);
  },
}));

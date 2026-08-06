import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: unknown = null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
const apiMock = vi.hoisted(() => ({
  dapSessionList: vi.fn(),
  dapSessionCreate: vi.fn(),
  dapSessionDisconnect: vi.fn(),
  dapSessionConnect: vi.fn(),
  dapRequestSend: vi.fn(),
}));
vi.mock("./api", () => apiMock);

import { useDapStore } from "./store";
import type { DapSessionInfo } from "./api";

const session: DapSessionInfo = {
  id: "s1",
  adapterType: "debugpy",
  transport: "stdio",
  status: "inactive",
  error: null,
};

beforeEach(() => {
  useDapStore.setState({
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
    launchArgs: "{}",
    busy: false,
  });
  for (const fn of Object.values(apiMock)) fn.mockReset();
  // dapRequestSend is awaited via `.catch(() => {})` in toggleBreakpoint; give it
  // a resolving default so an active-session toggle doesn't throw on undefined.
  apiMock.dapRequestSend.mockResolvedValue(undefined);
});

describe("useDapStore", () => {
  it("refresh loads sessions and marks loaded", async () => {
    apiMock.dapSessionList.mockResolvedValue([session]);
    await useDapStore.getState().refresh();
    expect(useDapStore.getState().sessions).toEqual([session]);
    expect(useDapStore.getState().loaded).toBe(true);
  });

  it("createSession creates then refreshes", async () => {
    apiMock.dapSessionList.mockResolvedValue([session]);
    await useDapStore
      .getState()
      .createSession({ id: "s1", adapterType: "debugpy", transport: "stdio" });
    expect(apiMock.dapSessionCreate).toHaveBeenCalledWith({
      id: "s1",
      adapterType: "debugpy",
      transport: "stdio",
    });
    expect(useDapStore.getState().loaded).toBe(true);
  });

  it("removeConfig refreshes the list", async () => {
    apiMock.dapSessionList.mockResolvedValue([]);
    await useDapStore.getState().removeConfig("s1");
    expect(apiMock.dapSessionList).toHaveBeenCalled();
  });

  it("toggleBreakpoint adds, toggles off, and keeps lines sorted", () => {
    const s = useDapStore.getState();
    s.toggleBreakpoint("/a/b.py", 5);
    s.toggleBreakpoint("/a/b.py", 2);
    expect(useDapStore.getState().breakpoints["/a/b.py"]).toEqual([2, 5]);
    useDapStore.getState().toggleBreakpoint("/a/b.py", 5);
    expect(useDapStore.getState().breakpoints["/a/b.py"]).toEqual([2]);
  });

  it("toggleBreakpoint with an active session pushes setBreakpoints", () => {
    useDapStore.setState({ activeSessionId: "s1" });
    useDapStore.getState().toggleBreakpoint("/a/b.py", 3);
    expect(apiMock.dapRequestSend).toHaveBeenCalledWith(
      "s1",
      "setBreakpoints",
      expect.objectContaining({
        source: expect.objectContaining({ path: "/a/b.py" }),
        breakpoints: [{ line: 3 }],
      }),
    );
  });

  it("selectFrame fetches scopes then variables", async () => {
    useDapStore.setState({ activeSessionId: "s1" });
    apiMock.dapRequestSend
      .mockResolvedValueOnce({
        success: true,
        body: { scopes: [{ variablesReference: 11 }] },
      })
      .mockResolvedValueOnce({
        success: true,
        body: { variables: [{ name: "x", value: "1", variablesReference: 0 }] },
      });
    await useDapStore.getState().selectFrame(7);
    expect(apiMock.dapRequestSend).toHaveBeenNthCalledWith(1, "s1", "scopes", {
      frameId: 7,
    });
    expect(apiMock.dapRequestSend).toHaveBeenNthCalledWith(
      2,
      "s1",
      "variables",
      { variablesReference: 11 },
    );
    expect(useDapStore.getState().variables).toEqual([
      { name: "x", value: "1", variablesReference: 0 },
    ]);
  });

  it("send rejects without an active session", async () => {
    await expect(useDapStore.getState().send("threads")).rejects.toThrow(
      "no active debug session",
    );
  });

  it("clearOutput empties the console", () => {
    useDapStore.setState({ output: [{ id: 1, category: "console", text: "hi" }] });
    useDapStore.getState().clearOutput();
    expect(useDapStore.getState().output).toEqual([]);
  });

  it("setLaunchArgs and hide update state", () => {
    useDapStore.setState({ activeSessionId: "s1" });
    useDapStore.getState().setLaunchArgs('{"program":"x"}');
    expect(useDapStore.getState().launchArgs).toBe('{"program":"x"}');
    useDapStore.getState().hide();
    expect(useDapStore.getState().activeSessionId).toBeNull();
  });
});

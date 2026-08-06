import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
const listenMock = vi.fn((_event: string, _handler: unknown) =>
  Promise.resolve(() => {}),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: unknown) => listenMock(event, handler),
}));

import { useMcpStatusBridge, useMcpStore } from "./store";
import type { McpServerInfo } from "./api";

const server: McpServerInfo = {
  id: "s1",
  name: "fs",
  transport: "stdio",
  status: "disconnected",
  error: null,
  tools: [],
  resources: [],
  prompts: [],
};

beforeEach(() => {
  useMcpStore.setState({ servers: [], loaded: false, busy: {} });
  invokeMock.mockReset();
  listenMock.mockClear();
});

describe("useMcpStore", () => {
  it("refresh loads servers and marks loaded", async () => {
    invokeMock.mockResolvedValue([server]);
    await useMcpStore.getState().refresh();
    expect(useMcpStore.getState().servers).toEqual([server]);
    expect(useMcpStore.getState().loaded).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("mcp_server_list");
  });

  it("add calls mcp_server_add with config then refreshes", async () => {
    invokeMock.mockResolvedValue([server]);
    await useMcpStore.getState().add({ id: "s1", name: "fs", transport: "stdio" });
    expect(invokeMock).toHaveBeenCalledWith("mcp_server_add", {
      config: { id: "s1", name: "fs", transport: "stdio" },
    });
    expect(useMcpStore.getState().servers).toEqual([server]);
  });

  it("remove calls mcp_server_remove then refreshes", async () => {
    invokeMock.mockResolvedValue([]);
    await useMcpStore.getState().remove("s1");
    expect(invokeMock).toHaveBeenCalledWith("mcp_server_remove", { id: "s1" });
    expect(useMcpStore.getState().loaded).toBe(true);
  });

  it("connect marks busy then clears on success", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "mcp_server_list") return [server];
      if (cmd === "mcp_server_connect") return null;
      throw new Error("unexpected command");
    });
    const pending = useMcpStore.getState().connect("s1", null);
    expect(useMcpStore.getState().busy["s1"]).toBe(true);
    await pending;
    expect(useMcpStore.getState().busy["s1"]).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("mcp_server_connect", {
      id: "s1",
      root: null,
      workspace: null,
    });
  });

  it("connect clears busy even when the call fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "mcp_server_connect") throw new Error("boom");
      if (cmd === "mcp_server_list") return [];
    });
    await expect(useMcpStore.getState().connect("s1", null)).rejects.toThrow("boom");
    expect(useMcpStore.getState().busy["s1"]).toBeUndefined();
  });

  it("disconnect calls mcp_server_disconnect then refreshes", async () => {
    invokeMock.mockResolvedValue([server]);
    await useMcpStore.getState().disconnect("s1");
    expect(invokeMock).toHaveBeenCalledWith("mcp_server_disconnect", { id: "s1" });
  });

  it("patch updates a single server status", () => {
    useMcpStore.setState({ servers: [{ ...server, status: "disconnected" }] });
    useMcpStore.getState().patch("s1", "connected");
    expect(useMcpStore.getState().servers[0].status).toBe("connected");
    expect(useMcpStore.getState().servers[0].error).toBeNull();
  });

  it("patch preserves an existing error when none is passed", () => {
    useMcpStore.setState({ servers: [{ ...server, error: "old" }] });
    useMcpStore.getState().patch("s1", "error", null);
    expect(useMcpStore.getState().servers[0].status).toBe("error");
    expect(useMcpStore.getState().servers[0].error).toBe("old");
  });
});

describe("useMcpStatusBridge", () => {
  it("registers the event listener only once", async () => {
    useMcpStatusBridge();
    useMcpStatusBridge();
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("yamet:mcp-status", expect.any(Function));
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  dapRequestSend,
  dapSessionConnect,
  dapSessionCreate,
  dapSessionDisconnect,
  dapSessionList,
} from "./api";

const mockInvoke = vi.mocked(invoke);

describe("dap api wrappers", () => {
  it("dapSessionList invokes the command with no args", async () => {
    mockInvoke.mockResolvedValue([]);
    await expect(dapSessionList()).resolves.toEqual([]);
    expect(mockInvoke).toHaveBeenCalledWith("dap_session_list");
  });

  it("dapSessionCreate forwards the config", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const config = {
      id: "s1",
      adapterType: "node",
      transport: "stdio" as const,
      adapterCommand: "node",
      adapterArgs: ["--inspect"],
      env: [{ name: "A", value: "1" }],
    };
    await dapSessionCreate(config);
    expect(mockInvoke).toHaveBeenCalledWith("dap_session_create", { config });
  });

  it("dapSessionConnect forwards id/root/workspace and the event channel", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const onEvent = { emit: vi.fn(), send: vi.fn(), onmessage: vi.fn() } as never;
    await dapSessionConnect("s1", "/ws", { kind: "local" }, onEvent);
    expect(mockInvoke).toHaveBeenCalledWith("dap_session_connect", {
      id: "s1",
      root: "/ws",
      workspace: { kind: "local" },
      onEvent,
    });
  });

  it("dapSessionConnect passes null root", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const onEvent = { emit: vi.fn(), send: vi.fn(), onmessage: vi.fn() } as never;
    await dapSessionConnect("s1", null, null, onEvent);
    expect(mockInvoke).toHaveBeenCalledWith("dap_session_connect", {
      id: "s1",
      root: null,
      workspace: null,
      onEvent,
    });
  });

  it("dapSessionDisconnect forwards the id", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await dapSessionDisconnect("s1");
    expect(mockInvoke).toHaveBeenCalledWith("dap_session_disconnect", {
      id: "s1",
    });
  });

  it("dapRequestSend maps args to the arguments key", async () => {
    mockInvoke.mockResolvedValue({
      seq: 1,
      type: "response",
      requestSeq: 2,
      success: true,
    });
    const res = await dapRequestSend("s1", "continue", { threadId: 1 });
    expect(res.success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("dap_request_send", {
      sessionId: "s1",
      command: "continue",
      arguments: { threadId: 1 },
    });
  });

  it("dapRequestSend defaults missing args to null", async () => {
    mockInvoke.mockResolvedValue({ success: true });
    await dapRequestSend("s1", "pause");
    expect(mockInvoke).toHaveBeenCalledWith("dap_request_send", {
      sessionId: "s1",
      command: "pause",
      arguments: null,
    });
  });
});

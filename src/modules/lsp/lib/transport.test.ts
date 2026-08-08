// biome-ignore-all lint/style/noNonNullAssertion: 测试断言数据必然存在
// biome-ignore-all lint/suspicious/noExplicitAny: 测试替身（mock Channel onmessage 回调）需要宽松类型
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => ({
  currentWorkspaceEnv: vi.fn(() => "local"),
}));
const messageChannels = vi.hoisted(() => new Map<number, { onmessage: any }>());
const exitChannels = vi.hoisted(() => new Map<number, { onmessage: any }>());
let channelSeq = 0;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    onmessage: any = null;
    constructor() {
      const id = channelSeq++;
      // start() constructs the message channel first, then the exit channel.
      if (id % 2 === 0) messageChannels.set(id / 2, this);
      else exitChannels.set((id - 1) / 2, this);
    }
  },
}));
vi.mock("@/modules/workspace", () => workspaceMock);

import { TauriLspTransport } from "./transport";

function lastMessageChannel() {
  const k = [...messageChannels.keys()];
  return messageChannels.get(k[k.length - 1]!)!;
}
function lastExitChannel() {
  const k = [...exitChannels.keys()];
  return exitChannels.get(k[k.length - 1]!)!;
}

const spawnArgs = { command: "clangd", args: ["--test"], root: "/repo" };

beforeEach(() => {
  invokeMock.mockReset();
  workspaceMock.currentWorkspaceEnv.mockClear();
  channelSeq = 0;
  messageChannels.clear();
  exitChannels.clear();
  invokeMock.mockResolvedValue(42);
});

describe("TauriLspTransport.start", () => {
  it("spawns the server with config and workspace env", async () => {
    const t = new TauriLspTransport();
    await t.start({ ...spawnArgs, env: { A: "1" }, maxMemoryMb: 512 });
    expect(invokeMock).toHaveBeenCalledWith(
      "lsp_spawn",
      expect.objectContaining({
        command: "clangd",
        args: ["--test"],
        env: { A: "1" },
        root: "/repo",
        maxRssMb: 512,
        workspace: "local",
      }),
    );
    expect(workspaceMock.currentWorkspaceEnv).toHaveBeenCalled();
  });

  it("passes null env and maxRssMb when not provided", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    expect(invokeMock).toHaveBeenCalledWith(
      "lsp_spawn",
      expect.objectContaining({ env: null, maxRssMb: null }),
    );
  });
});

describe("message framing / server-request answering", () => {
  it("forwards decoded server messages to onMessage", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    const onMsg = vi.fn();
    t.onMessage(onMsg);
    const ch = lastMessageChannel();
    ch.onmessage(new TextEncoder().encode('{"jsonrpc":"2.0","method":"a"}'));
    expect(onMsg).toHaveBeenCalledWith('{"jsonrpc":"2.0","method":"a"}');
  });

  it("buffers messages until onMessage subscribes (backlog flush)", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    const ch = lastMessageChannel();
    ch.onmessage(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"m"}'));
    const onMsg = vi.fn();
    t.onMessage(onMsg);
    expect(onMsg).toHaveBeenCalledTimes(1);
    expect(onMsg).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"method":"m"}');
  });

  it("answers workspace/configuration with null results", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.onMessage(vi.fn());
    const ch = lastMessageChannel();
    invokeMock.mockResolvedValue(undefined);
    ch.onmessage(
      new TextEncoder().encode(
        '{"jsonrpc":"2.0","id":7,"method":"workspace/configuration","params":{"items":[{"section":"x"}]}}',
      ),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "lsp_send",
      expect.objectContaining({
        id: 42,
        message: expect.stringContaining('"id":7'),
      }),
    );
    const sent = invokeMock.mock.calls.find((c) => c[0] === "lsp_send")?.[1]
      .message;
    expect(JSON.parse(sent).result).toEqual([null]);
  });

  it("answers capability/request methods with null result", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.onMessage(vi.fn());
    const ch = lastMessageChannel();
    invokeMock.mockResolvedValue(undefined);
    ch.onmessage(
      new TextEncoder().encode(
        '{"jsonrpc":"2.0","id":3,"method":"client/registerCapability"}',
      ),
    );
    const sent = invokeMock.mock.calls.find((c) => c[0] === "lsp_send")?.[1]
      .message;
    expect(JSON.parse(sent).result).toBeNull();
  });

  it("answers unknown methods with a method-not-found error", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.onMessage(vi.fn());
    const ch = lastMessageChannel();
    invokeMock.mockResolvedValue(undefined);
    ch.onmessage(
      new TextEncoder().encode(
        '{"jsonrpc":"2.0","id":9,"method":"custom/unknown"}',
      ),
    );
    const sent = invokeMock.mock.calls.find((c) => c[0] === "lsp_send")?.[1]
      .message;
    const parsed = JSON.parse(sent);
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("custom/unknown");
  });

  it("does not answer plain notifications (no id/method pre-check)", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.onMessage(vi.fn());
    const ch = lastMessageChannel();
    ch.onmessage(
      new TextEncoder().encode('{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics"}'),
    );
    expect(invokeMock).not.toHaveBeenCalledWith("lsp_send", expect.anything());
  });

  it("answers a request only once and ignores malformed payloads", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.onMessage(vi.fn());
    const ch = lastMessageChannel();
    invokeMock.mockResolvedValue(undefined);
    ch.onmessage(new TextEncoder().encode('{"id":1,"method":"window/workDoneProgress/create"}'));
    ch.onmessage(new TextEncoder().encode("not json"));
    const sends = invokeMock.mock.calls.filter((c) => c[0] === "lsp_send");
    expect(sends).toHaveLength(1);
  });
});

describe("TauriLspTransport lifecycle", () => {
  it("send forwards messages with the session id", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.send("hello");
    expect(invokeMock).toHaveBeenCalledWith(
      "lsp_send",
      expect.objectContaining({ id: 42, message: "hello" }),
    );
  });

  it("send is a no-op before start and after close", async () => {
    const t = new TauriLspTransport();
    t.send("x");
    expect(invokeMock).not.toHaveBeenCalledWith("lsp_send", expect.anything());
    await t.start(spawnArgs);
    t.close();
    t.send("y");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "lsp_send",
      expect.objectContaining({ message: "y" }),
    );
  });

  it("send surfaces invoke failures through onError", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    const onErr = vi.fn();
    t.onError(onErr);
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await t.send("z");
    await vi.waitFor(() => expect(onErr).toHaveBeenCalled());
    expect(onErr).toHaveBeenCalledWith(expect.any(Error));
  });

  it("close kills the running server and drops the session id", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.close();
    expect(invokeMock).toHaveBeenCalledWith(
      "lsp_kill",
      expect.objectContaining({ id: 42 }),
    );
  });

  it("exit channel triggers onClose with exitInfo", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    const onClose = vi.fn();
    t.onClose(onClose);
    const exit = lastExitChannel();
    exit.onmessage({ code: 1, stderrTail: "oops", reason: "budget" });
    expect(t.exitInfo).toMatchObject({ code: 1, reason: "budget" });
    expect(onClose).toHaveBeenCalled();
  });

  it("onClose fires immediately if the transport already exited", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    lastExitChannel().onmessage({ code: 1, stderrTail: "", reason: null });
    const onClose = vi.fn();
    t.onClose(onClose);
    expect(onClose).toHaveBeenCalled();
  });

  it("close on an already-closed transport only clears the session id", async () => {
    const t = new TauriLspTransport();
    await t.start(spawnArgs);
    t.close();
    invokeMock.mockClear();
    t.close();
    expect(invokeMock).not.toHaveBeenCalledWith("lsp_kill", expect.anything());
  });
});

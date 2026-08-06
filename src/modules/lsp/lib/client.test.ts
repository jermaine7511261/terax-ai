import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "codemirror-languageserver";
import { YametLspClient } from "./client";

function fakeTransport(): Transport {
  return {
    send: () => {},
    onMessage: () => {},
    onClose: () => {},
    onError: () => {},
    close: () => {},
  };
}

function makeClient(over: Partial<{ hostPid: number | null }> = {}) {
  YametLspClient.hostPid = over.hostPid ?? null;
  const client = new YametLspClient({
    transport: fakeTransport(),
    rootUri: "file:///ws",
    workspaceFolders: [{ uri: "file:///ws", name: "ws" }],
    documentUri: "file:///ws/a.ts",
    languageId: "typescript",
    onClose: () => {},
    onError: () => {},
  });
  // The inherited protected request/notify are the `raw` the subclass
  // forwards to; intercept them to assert method dispatch without a server.
  const c = client as unknown as {
    request: (...a: unknown[]) => Promise<unknown>;
    notify: (...a: unknown[]) => Promise<unknown>;
  };
  const request = vi.spyOn(c, "request").mockResolvedValue(undefined);
  const notify = vi.spyOn(c, "notify").mockResolvedValue(undefined);
  return { client, request, notify };
}

beforeEach(() => {
  YametLspClient.hostPid = null;
});

describe("YametLspClient", () => {
  it("textDocumentReferences issues a references request with a 10s timeout", () => {
    const { client, request } = makeClient();
    const params = {
      textDocument: { uri: "file:///ws/a.ts" },
      position: { line: 2, character: 3 },
      context: { includeDeclaration: true },
    };
    void client.textDocumentReferences(params);
    expect(request).toHaveBeenCalledWith("textDocument/references", params, 10_000);
  });

  it("textDocumentCodeAction issues a codeAction request", () => {
    const { client, request } = makeClient();
    const params = {
      textDocument: { uri: "file:///ws/a.ts" },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
      context: { diagnostics: [] },
    };
    void client.textDocumentCodeAction(params);
    expect(request).toHaveBeenCalledWith("textDocument/codeAction", params, 10_000);
  });

  it("workspaceExecuteCommand issues an executeCommand request with a 15s timeout", () => {
    const { client, request } = makeClient();
    const params = { command: "refactor.rewrite", arguments: [1, "x"] };
    void client.workspaceExecuteCommand(params);
    expect(request).toHaveBeenCalledWith("workspace/executeCommand", params, 15_000);
  });

  it("textDocumentDiagnostic issues a pull-diagnostics request with an 8s timeout", () => {
    const { client, request } = makeClient();
    void client.textDocumentDiagnostic({ textDocument: { uri: "u" } });
    expect(request).toHaveBeenCalledWith(
      "textDocument/diagnostic",
      { textDocument: { uri: "u" } },
      8_000,
    );
  });

  it("textDocumentDidClose notifies didClose with the uri", () => {
    const { client, notify } = makeClient();
    client.textDocumentDidClose("file:///ws/a.ts");
    expect(notify).toHaveBeenCalledWith("textDocument/didClose", {
      textDocument: { uri: "file:///ws/a.ts" },
    });
  });

  it("textDocumentDidSave notifies didSave", () => {
    const { client, notify } = makeClient();
    client.textDocumentDidSave("file:///ws/a.ts");
    expect(notify).toHaveBeenCalledWith("textDocument/didSave", {
      textDocument: { uri: "file:///ws/a.ts" },
    });
  });

  it("textDocumentDidSaveWithText sends the full buffer", () => {
    const { client, notify } = makeClient();
    client.textDocumentDidSaveWithText("file:///ws/a.ts", "const x = 1;");
    expect(notify).toHaveBeenCalledWith("textDocument/didSave", {
      textDocument: { uri: "file:///ws/a.ts" },
      text: "const x = 1;",
    });
  });

  it("textDocumentDidOpenFull sends a full open with version 1", () => {
    const { client, notify } = makeClient();
    client.textDocumentDidOpenFull("file:///ws/a.ts", "let y = 2;", "typescript");
    expect(notify).toHaveBeenCalledWith("textDocument/didOpen", {
      textDocument: { uri: "file:///ws/a.ts", languageId: "typescript", version: 1, text: "let y = 2;" },
    });
  });

  it("shutdownGracefully sends shutdown then exit", async () => {
    const { client, request, notify } = makeClient();
    await client.shutdownGracefully(500);
    expect(request).toHaveBeenCalledWith("shutdown", null, 500);
    expect(notify).toHaveBeenCalledWith("exit", null);
  });

  it("shutdownGracefully swallows request failures", async () => {
    const { client, request, notify } = makeClient();
    request.mockRejectedValueOnce(new Error("boom"));
    await expect(client.shutdownGracefully(500)).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalledWith("exit", null);
  });

  it("getInitializeParams injects hostPid and publishDiagnostics capability", () => {
    const { client } = makeClient({ hostPid: 4242 });
    const params = (
      client as unknown as {
        getInitializeParams(): Record<string, unknown>;
      }
    ).getInitializeParams();
    expect(params.processId).toBe(4242);
    const caps = params.capabilities as {
      textDocument: { publishDiagnostics: unknown };
    };
    expect(caps.textDocument.publishDiagnostics).toEqual({
      relatedInformation: true,
    });
  });

  it("getInitializeParams leaves processId null when hostPid is unset", () => {
    const { client } = makeClient({ hostPid: null });
    const params = (
      client as unknown as {
        getInitializeParams(): Record<string, unknown>;
      }
    ).getInitializeParams();
    expect(params.processId).toBeNull();
  });
});

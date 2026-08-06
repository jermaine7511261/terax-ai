import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

import { buildTerminalTools } from "./terminal";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(overrides: Partial<ToolContext> = {}) {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    executeInActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
    ...overrides,
  } as ToolContext;
}

type ToolResult = Record<string, unknown>;
async function runTool(
  ctx: ToolContext,
  name: keyof ReturnType<typeof buildTerminalTools>,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const execute = buildTerminalTools(ctx)[name].execute;
  if (!execute) throw new Error(`no execute for ${name}`);
  return (await execute(input as never, toolOptions)) as unknown as ToolResult;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("suggest_command", () => {
  it("returns the command when safe and single-line", async () => {
    const result = await runTool(makeContext(), "suggest_command", {
      command: "ls -la",
      explanation: "list files",
    });
    expect(result).toEqual({ command: "ls -la", explanation: "list files" });
  });

  it("rejects control bytes", async () => {
    const result = await runTool(makeContext(), "suggest_command", {
      command: "ls;\nrm -rf /",
    });
    expect(result.error).toMatch(/control characters/i);
  });

  it("rejects an unsafe command via security check", async () => {
    const result = await runTool(makeContext(), "suggest_command", {
      command: "rm -rf /",
    });
    expect(result.error).toMatch(/Refused/i);
  });
});

describe("get_terminal_output", () => {
  it("refuses in privacy mode", async () => {
    const ctx = makeContext({ isActiveTerminalPrivate: () => true });
    const result = await runTool(ctx, "get_terminal_output", {});
    expect(result.error).toMatch(/Privacy mode/i);
  });

  it("returns empty output when no active terminal", async () => {
    const result = await runTool(makeContext(), "get_terminal_output", {});
    expect(result).toEqual({ output: "", note: "no active terminal" });
  });

  it("returns tail lines and caps output size", async () => {
    const buffer = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    const ctx = makeContext({ getTerminalContext: () => buffer });
    const result = await runTool(ctx, "get_terminal_output", { lines: 10 });
    expect(result.lines_returned).toBe(10);
    // Only the last 10 lines are returned (joined with \n).
    expect(String(result.output)).toBe("line90\nline91\nline92\nline93\nline94\nline95\nline96\nline97\nline98\nline99");
  });

  it("truncates output beyond MAX bytes", async () => {
    const buffer = "x".repeat(30_000);
    const ctx = makeContext({ getTerminalContext: () => buffer });
    const result = await runTool(ctx, "get_terminal_output", {});
    expect(String(result.output)).toContain("…[truncated]…");
    expect(String(result.output).length).toBeLessThan(24_100);
  });
});

describe("terminal_execute", () => {
  it("refuses in privacy mode", async () => {
    const ctx = makeContext({ isActiveTerminalPrivate: () => true });
    const result = await runTool(ctx, "terminal_execute", { command: "ls" });
    expect(result.error).toMatch(/Privacy mode/i);
  });

  it("rejects an empty command", async () => {
    const result = await runTool(makeContext(), "terminal_execute", {
      command: "",
    });
    expect(result.error).toBe("command cannot be empty");
  });

  it("rejects an unsafe command", async () => {
    const result = await runTool(makeContext(), "terminal_execute", {
      command: "rm -rf /",
    });
    expect(result.error).toMatch(/Refused/i);
  });

  it("strips trailing newlines and executes", async () => {
    const execute = vi.fn(() => true);
    const ctx = makeContext({ executeInActivePty: execute });
    const result = await runTool(ctx, "terminal_execute", {
      command: "pnpm dev\n",
      note: "start server",
    });
    expect(execute).toHaveBeenCalledWith("pnpm dev");
    expect(result).toEqual({ ok: true, ran: "pnpm dev", note: "start server" });
  });

  it("reports no active terminal tab", async () => {
    const ctx = makeContext({ executeInActivePty: () => false });
    const result = await runTool(ctx, "terminal_execute", { command: "ls" });
    expect(result.error).toBe("no active terminal tab to run in");
  });
});

describe("terminal_type", () => {
  it("refuses control bytes", async () => {
    const result = await runTool(makeContext(), "terminal_type", {
      text: "hi\x1b[D",
    });
    expect(result.error).toBe("text must not contain control bytes");
  });

  it("rejects empty text", async () => {
    const result = await runTool(makeContext(), "terminal_type", { text: "" });
    expect(result.error).toBe("text cannot be empty");
  });

  it("injects text without entering", async () => {
    const inject = vi.fn(() => true);
    const ctx = makeContext({ injectIntoActivePty: inject });
    const result = await runTool(ctx, "terminal_type", { text: "hello" });
    expect(inject).toHaveBeenCalledWith("hello");
    expect(result).toEqual({ ok: true, typed: "hello", note: undefined });
  });
});

describe("open_preview", () => {
  it("returns an error for an invalid URL", async () => {
    const result = await runTool(makeContext(), "open_preview", {
      url: "not a url",
    });
    expect(result.error).toBe("invalid URL");
  });

  it("rejects non-http/https protocols", async () => {
    const result = await runTool(makeContext(), "open_preview", {
      url: "ftp://example.com",
    });
    expect(result.error).toMatch(/only http\/https/i);
  });

  it("rejects non-local hosts", async () => {
    const result = await runTool(makeContext(), "open_preview", {
      url: "https://example.com",
    });
    expect(result.error).toMatch(/restricted to localhost/i);
  });

  it("accepts loopback hosts and calls openPreview", async () => {
    const open = vi.fn(() => true);
    const ctx = makeContext({ openPreview: open });
    const result = await runTool(ctx, "open_preview", {
      url: "http://localhost:5173",
    });
    expect(open).toHaveBeenCalledWith("http://localhost:5173");
    expect(result).toEqual({ url: "http://localhost:5173", ok: true });
  });

  it("reports when the preview surface is unavailable", async () => {
    const ctx = makeContext({ openPreview: () => false });
    const result = await runTool(ctx, "open_preview", {
      url: "http://127.0.0.1:3000",
    });
    expect(result.error).toBe("preview surface unavailable");
  });
});

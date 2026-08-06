import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  shellSessionOpen: vi.fn(async () => 42),
  shellSessionRun: vi.fn(),
  shellBgSpawn: vi.fn(),
  shellBgLogs: vi.fn(),
  shellBgList: vi.fn(),
  shellBgKill: vi.fn(async () => undefined),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => "local",
  workspaceScopeKey: () => "ws-key",
}));

import { buildShellTools } from "./shell";

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
  name: keyof ReturnType<typeof buildShellTools>,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const execute = buildShellTools(ctx)[name].execute;
  if (!execute) throw new Error(`no execute for ${name}`);
  return (await execute(input as never, toolOptions)) as unknown as ToolResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMock.shellSessionOpen.mockResolvedValue(42);
});

describe("bash_run", () => {
  it("rejects an empty command", async () => {
    const result = await runTool(makeContext(), "bash_run", { command: "  " });
    expect(result.error).toMatch(/empty command/i);
  });

  it("rejects an unsafe command", async () => {
    const result = await runTool(makeContext(), "bash_run", {
      command: "rm -rf /",
    });
    expect(result.error).toMatch(/Refused/i);
  });

  it("returns an error when there is no session id", async () => {
    const ctx = makeContext({ getSessionId: () => null });
    const result = await runTool(ctx, "bash_run", { command: "ls" });
    expect(result.error).toBe("no active chat session");
  });

  it("runs a command via the session shell", async () => {
    nativeMock.shellSessionRun.mockResolvedValue({
      stdout: "out",
      stderr: "",
      exit_code: 0,
      timed_out: false,
      truncated: false,
      cwd_after: "/workspace",
    });
    const result = await runTool(makeContext(), "bash_run", {
      command: "pwd",
      timeout_secs: 30,
    });
    expect(nativeMock.shellSessionOpen).toHaveBeenCalledWith("/workspace");
    expect(nativeMock.shellSessionRun).toHaveBeenCalledWith(
      42,
      "pwd",
      "/workspace",
      30,
    );
    expect(result).toMatchObject({ command: "pwd", stdout: "out", exit_code: 0 });
  });

  it("reuses the same session shell across calls for the same session", async () => {
    nativeMock.shellSessionRun.mockResolvedValue({
      stdout: "x",
      stderr: "",
      exit_code: 0,
      timed_out: false,
      truncated: false,
      cwd_after: "/workspace",
    });
    const ctx = makeContext({ getSessionId: () => "reuse-test-session" });
    await runTool(ctx, "bash_run", { command: "a" });
    await runTool(ctx, "bash_run", { command: "b" });
    expect(nativeMock.shellSessionOpen).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error from the shell", async () => {
    nativeMock.shellSessionRun.mockRejectedValue(new Error("spawn failed"));
    const result = await runTool(makeContext(), "bash_run", { command: "ls" });
    expect(result.error).toBe("Error: spawn failed");
  });
});

describe("bash_background", () => {
  it("rejects an empty command", async () => {
    const result = await runTool(makeContext(), "bash_background", {
      command: "",
    });
    expect(result.error).toMatch(/empty command/i);
  });

  it("spawns a background process with explicit cwd", async () => {
    nativeMock.shellBgSpawn.mockResolvedValue(7);
    const result = await runTool(makeContext(), "bash_background", {
      command: "pnpm dev",
      cwd: "/project",
    });
    expect(nativeMock.shellBgSpawn).toHaveBeenCalledWith("pnpm dev", "/project");
    expect(result).toMatchObject({ handle: 7, command: "pnpm dev", cwd: "/project", ok: true });
  });

  it("falls back to ctx cwd when cwd not given", async () => {
    nativeMock.shellBgSpawn.mockResolvedValue(1);
    await runTool(makeContext(), "bash_background", { command: "ls" });
    expect(nativeMock.shellBgSpawn).toHaveBeenCalledWith("ls", "/workspace");
  });
});

describe("bash_logs / bash_list / bash_kill", () => {
  it("bash_logs returns the native result", async () => {
    nativeMock.shellBgLogs.mockResolvedValue({
      bytes: "out",
      next_offset: 10,
      dropped: 0,
      exited: true,
      exit_code: 0,
    });
    const result = await runTool(makeContext(), "bash_logs", {
      handle: 3,
      since_offset: 5,
    });
    expect(nativeMock.shellBgLogs).toHaveBeenCalledWith(3, 5);
    expect(result).toMatchObject({ bytes: "out", next_offset: 10 });
  });

  it("bash_logs surfaces an error", async () => {
    nativeMock.shellBgLogs.mockRejectedValue(new Error("no handle"));
    const result = await runTool(makeContext(), "bash_logs", { handle: 99 });
    expect(result.error).toBe("Error: no handle");
  });

  it("bash_list returns processes", async () => {
    nativeMock.shellBgList.mockResolvedValue([{ handle: 1, command: "ls" }]);
    const result = await runTool(makeContext(), "bash_list", {});
    expect(result.processes).toEqual([{ handle: 1, command: "ls" }]);
  });

  it("bash_kill kills by handle", async () => {
    const result = await runTool(makeContext(), "bash_kill", { handle: 4 });
    expect(nativeMock.shellBgKill).toHaveBeenCalledWith(4);
    expect(result).toEqual({ handle: 4, ok: true });
  });

  it("bash_kill surfaces an error", async () => {
    nativeMock.shellBgKill.mockRejectedValue(new Error("gone"));
    const result = await runTool(makeContext(), "bash_kill", { handle: 4 });
    expect(result.error).toBe("Error: gone");
  });
});

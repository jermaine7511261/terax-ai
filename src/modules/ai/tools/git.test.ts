import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  gitResolveRepo: vi.fn(
    async (): Promise<{ repoRoot: string } | null> => ({ repoRoot: "/repo" }),
  ),
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitStage: vi.fn(async () => undefined),
  gitCommit: vi.fn(),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));
vi.mock("@/modules/workspace", () => ({ currentWorkspaceEnv: () => "local" }));

import { buildGitTools } from "./git";

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
  name: keyof ReturnType<typeof buildGitTools>,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const execute = buildGitTools(ctx)[name].execute;
  if (!execute) throw new Error(`no execute for ${name}`);
  return (await execute(input as never, toolOptions)) as unknown as ToolResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMock.gitResolveRepo.mockResolvedValue({ repoRoot: "/repo" });
});

describe("git_status", () => {
  it("returns a note when not inside a git repository", async () => {
    nativeMock.gitResolveRepo.mockResolvedValue(null);
    const result = await runTool(makeContext(), "git_status", {});
    expect(result.note).toBe("not inside a git repository");
  });

  it("returns a note when there is no cwd or workspace root", async () => {
    nativeMock.gitResolveRepo.mockImplementation(async () => {
      throw new Error("boom");
    });
    const ctx = makeContext({ getCwd: () => null, getWorkspaceRoot: () => null });
    const result = await runTool(ctx, "git_status", {});
    expect(result.note).toBe("not inside a git repository");
  });

  it("returns status summary and capped file list", async () => {
    nativeMock.gitStatus.mockResolvedValue({
      branch: "main",
      ahead: 2,
      behind: 0,
      changedFiles: [
        { statusLabel: "M", path: "a.ts", originalPath: null },
        { statusLabel: "??", path: "b.ts", originalPath: "old.ts" },
      ],
    });
    const result = await runTool(makeContext(), "git_status", {});
    expect(result.repoRoot).toBe("/repo");
    expect(result.branch).toBe("main");
    expect(result.ahead).toBe(2);
    expect(result.behind).toBe(0);
    expect(result.summary).toContain("Branch: main");
    expect(result.summary).toContain("2 ahead of upstream");
    expect(result.summary).toContain("Changed files: 2");
    expect(result.changedFiles).toEqual(["M  a.ts", "??  b.ts (was old.ts)"]);
    expect(result.truncated).toBe(false);
    expect(result.totalChanged).toBe(2);
    expect(nativeMock.gitStatus).toHaveBeenCalledWith("/repo");
  });

  it("surfaces an error from gitStatus", async () => {
    nativeMock.gitStatus.mockRejectedValue(new Error("git failed"));
    const result = await runTool(makeContext(), "git_status", {});
    expect(result.error).toBe("Error: git failed");
    expect(result.repoRoot).toBe("/repo");
  });
});

describe("git_diff", () => {
  it("returns diff text with staged=false default", async () => {
    nativeMock.gitDiff.mockResolvedValue({ diffText: "diff", truncated: false });
    const result = await runTool(makeContext(), "git_diff", {});
    expect(nativeMock.gitDiff).toHaveBeenCalledWith("/repo", null, false);
    expect(result).toMatchObject({ repoRoot: "/repo", staged: false, diffText: "diff" });
  });

  it("passes path and staged", async () => {
    nativeMock.gitDiff.mockResolvedValue({ diffText: "", truncated: false });
    await runTool(makeContext(), "git_diff", { path: "src/x.ts", staged: true });
    expect(nativeMock.gitDiff).toHaveBeenCalledWith("/repo", "src/x.ts", true);
  });
});

describe("git_stage", () => {
  it("stages all changes when no paths given", async () => {
    const result = await runTool(makeContext(), "git_stage", {});
    expect(nativeMock.gitStage).toHaveBeenCalledWith("/repo", []);
    expect(result.staged).toEqual(["(all changes)"]);
    expect(result.ok).toBe(true);
  });

  it("stages the given paths", async () => {
    const result = await runTool(makeContext(), "git_stage", {
      paths: ["a.ts", "b.ts"],
    });
    expect(nativeMock.gitStage).toHaveBeenCalledWith("/repo", ["a.ts", "b.ts"]);
    expect(result.staged).toEqual(["a.ts", "b.ts"]);
  });
});

describe("git_commit", () => {
  it("rejects an empty commit message", async () => {
    const result = await runTool(makeContext(), "git_commit", {
      message: "   ",
    });
    expect(result.error).toBe("commit message cannot be empty");
    expect(nativeMock.gitCommit).not.toHaveBeenCalled();
  });

  it("commits with a trimmed message", async () => {
    nativeMock.gitCommit.mockResolvedValue({ commitSha: "abc", summary: "fix" });
    const result = await runTool(makeContext(), "git_commit", {
      message: "  fix: thing  ",
    });
    expect(nativeMock.gitCommit).toHaveBeenCalledWith("/repo", "fix: thing");
    expect(result.ok).toBe(true);
    expect(result.commit).toEqual({ commitSha: "abc", summary: "fix" });
  });
});

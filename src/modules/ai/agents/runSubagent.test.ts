// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs } from "ai";
import { buildConfiguredLanguageModel } from "../lib/agent";
import { buildFsTools } from "../tools/fs";
import { buildNetTools } from "../tools/net";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS } from "./registry";
import { DEFAULT_MODEL_ID } from "../config";
import type { ToolContext } from "../tools/context";
import { runSubagent, DEFAULT_SUBAGENT_MODEL } from "./runSubagent";

// Mocks isolate the LLM call and the tool builders so we can assert on the
// wiring (tool filtering / approval stripping / options passed to generateText).
vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(),
}));
vi.mock("../lib/agent", () => ({
  buildConfiguredLanguageModel: vi.fn(),
}));
vi.mock("../tools/fs", () => ({
  buildFsTools: vi.fn(() => ({
    read_file: { name: "read_file", needsApproval: false },
    // Deliberately give a read-only tool needsApproval so we can prove the
    // runner does NOT strip it (only writable tools are stripped).
    list_directory: { name: "list_directory", needsApproval: true },
  })),
}));
vi.mock("../tools/search", () => ({
  buildSearchTools: vi.fn(() => ({
    grep: { name: "grep" },
    glob: { name: "glob" },
  })),
}));
vi.mock("../tools/net", () => ({
  buildNetTools: vi.fn(() => ({
    web_search: { name: "web_search" },
    fetch_url: { name: "fetch_url" },
  })),
}));
vi.mock("../tools/edit", () => ({
  buildEditTools: vi.fn(() => ({
    write_file: { name: "write_file", needsApproval: true },
    edit: { name: "edit", needsApproval: true },
    multi_edit: { name: "multi_edit", needsApproval: true },
    create_directory: { name: "create_directory", needsApproval: true },
    delete_file: { name: "delete_file", needsApproval: true },
    rename_file: { name: "rename_file", needsApproval: true },
  })),
}));
vi.mock("../tools/git", () => ({
  buildGitTools: vi.fn(() => ({
    git_stage: { name: "git_stage", needsApproval: true },
    git_commit: { name: "git_commit", needsApproval: true },
  })),
}));
vi.mock("../tools/shell", () => ({
  buildShellTools: vi.fn(() => ({
    bash_run: { name: "bash_run", needsApproval: true },
    bash_background: { name: "bash_background", needsApproval: true },
    bash_logs: { name: "bash_logs" },
    bash_list: { name: "bash_list" },
    bash_kill: { name: "bash_kill", needsApproval: true },
  })),
}));

const ctx = {} as ToolContext;
const keys = { deepseek: "sk-test" } as never;

function baseArgs(over: Record<string, unknown> = {}) {
  return {
    type: "explore",
    prompt: "do the thing",
    keys,
    modelId: "deepseek-v4-flash",
    toolContext: ctx,
    ...over,
  } as never;
}

type GenOpts = Record<string, unknown> & {
  onStepFinish?: (step: { toolCalls?: { toolName: string }[] }) => void;
};

function lastGenOpts(): GenOpts {
  const opts = vi.mocked(generateText).mock.calls.at(-1)?.[0] as GenOpts;
  if (!opts) throw new Error("generateText was not called");
  return opts;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildConfiguredLanguageModel).mockResolvedValue({ id: "m" } as never);
  vi.mocked(generateText).mockResolvedValue({
    text: "summary",
    steps: [1, 2],
  } as never);
  vi.mocked(stepCountIs).mockImplementation(
    (n: number) => ({ kind: "stepCount", max: n }) as never,
  );
});

describe("runSubagent input validation", () => {
  it("rejects an unknown subagent type", async () => {
    await expect(
      runSubagent(baseArgs({ type: "not-a-type" })),
    ).rejects.toThrow(/unknown subagent type: not-a-type/);
  });
});

describe("runSubagent tool wiring", () => {
  it("builds a read-only toolset for a read-only subagent type", async () => {
    await runSubagent(baseArgs({ type: "explore" }));

    expect(vi.mocked(buildFsTools)).toHaveBeenCalledWith(ctx);
    expect(vi.mocked(buildSearchTools)).toHaveBeenCalledWith(ctx);

    const opts = lastGenOpts();
    // Only the whitelisted read-only tools are exposed; the writable builders'
    // output is filtered out for a read-only subagent.
    expect(Object.keys(opts.tools as object)).toEqual([
      "read_file",
      "list_directory",
      "grep",
      "glob",
    ]);
  });

  it("strips needsApproval from writable tools but preserves read-only tools", async () => {
    await runSubagent(baseArgs({ type: "code" }));

    const tools = lastGenOpts().tools as Record<string, Record<string, unknown>>;

    // Writable tools had needsApproval:true and must have it removed so the
    // ai SDK doesn't block them inside the subagent's generateText run.
    expect("needsApproval" in tools.write_file).toBe(false);
    expect("needsApproval" in tools.git_commit).toBe(false);
    expect(tools.write_file.name).toBe("write_file");

    // Read-only tools are passed through untouched (still carry needsApproval).
    expect(tools.list_directory.needsApproval).toBe(true);
    expect(tools.read_file.name).toBe("read_file");
  });

  it("exposes shell tools for the executor type", async () => {
    await runSubagent(baseArgs({ type: "executor" }));
    const tools = lastGenOpts().tools as Record<string, unknown>;
    expect("bash_run" in tools).toBe(true);
    expect("bash_kill" in tools).toBe(true);
  });

  it("exposes web tools for the general type (MUST 差距 1: deep_search researcher/verifier)", async () => {
    await runSubagent(baseArgs({ type: "general" }));
    expect(vi.mocked(buildNetTools)).toHaveBeenCalledWith(ctx);
    const tools = lastGenOpts().tools as Record<string, unknown>;
    expect("web_search" in tools).toBe(true);
    expect("fetch_url" in tools).toBe(true);
  });

  it("does not expose web tools for non-web subagent types", async () => {
    await runSubagent(baseArgs({ type: "explore" }));
    expect(vi.mocked(buildNetTools)).toHaveBeenCalledWith(ctx); // pool built
    const tools = lastGenOpts().tools as Record<string, unknown>;
    expect("web_search" in tools).toBe(false); // filtered by whitelist
  });
});

describe("runSubagent options building", () => {
  it("forwards model config to buildConfiguredLanguageModel", async () => {
    await runSubagent(
      baseArgs({
        type: "general",
        llamaCppBaseURL: "http://localhost:8080/v1",
        customEndpoints: [{ id: "e1", baseURL: "http://x", modelId: "m", contextLimit: 1 }],
        customEndpointKeys: { e1: "ck" },
      }),
    );

    expect(vi.mocked(buildConfiguredLanguageModel)).toHaveBeenCalledWith(
      "deepseek-v4-flash",
      keys,
      {
        customEndpoints: [{ id: "e1", baseURL: "http://x", modelId: "m", contextLimit: 1 }],
        customEndpointKeys: { e1: "ck" },
        llamaCppBaseURL: "http://localhost:8080/v1",
      },
    );
  });

  it("passes the subagent system prompt, user prompt and step cap to generateText", async () => {
    await runSubagent(baseArgs({ type: "code-review", prompt: "review diff" }));

    const opts = lastGenOpts();
    expect(opts.system).toContain(SUBAGENTS["code-review"].systemPrompt);
    expect(opts.system).toContain("plain-text summary");
    expect(opts.prompt).toBe("review diff");
    expect(opts.stopWhen).toEqual({ kind: "stepCount", max: 12 });
  });

  it("reports each step's tool call via onStep", async () => {
    const onStep = vi.fn();
    await runSubagent(baseArgs({ type: "explore", onStep }));

    lastGenOpts().onStepFinish?.({ toolCalls: [{ toolName: "read_file" }] });
    expect(onStep).toHaveBeenCalledWith("explore: read_file");
  });

  it("skips onStep when the step has no tool calls", async () => {
    const onStep = vi.fn();
    await runSubagent(baseArgs({ type: "explore", onStep }));

    lastGenOpts().onStepFinish?.({ toolCalls: [] });
    lastGenOpts().onStepFinish?.({});
    expect(onStep).not.toHaveBeenCalled();
  });

  it("does not throw when onStep is omitted", async () => {
    await expect(runSubagent(baseArgs({ type: "explore" }))).resolves.toBeDefined();
    expect(() => lastGenOpts().onStepFinish?.({})).not.toThrow();
  });
});

describe("runSubagent result shaping", () => {
  it("returns summary, step count and a duration", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "hello world",
      steps: [{}, {}, {}],
    } as never);

    const result = await runSubagent(baseArgs({ type: "general" }));

    expect(result.summary).toBe("hello world");
    expect(result.stepCount).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back to '(no output)' when the model returns no text", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "", steps: [] } as never);

    const result = await runSubagent(baseArgs({ type: "general" }));

    expect(result.summary).toBe("(no output)");
    expect(result.stepCount).toBe(0);
  });

  it("retries once with a summary nudge when the tool loop ends without text", async () => {
    // First generateText: tool-heavy loop, no final text (the multi-step-no-
    // summary failure). Second call (the nudge) returns the actual summary.
    vi.mocked(generateText)
      .mockResolvedValueOnce({
        text: "",
        steps: [
          { toolCalls: [{ toolName: "read_file" }], toolResults: [{ toolName: "read_file" }] },
          { toolCalls: [], toolResults: [], text: "" },
        ],
      } as never)
      .mockResolvedValueOnce({ text: "found the bug in src/main.ts" } as never);

    const result = await runSubagent(baseArgs({ type: "explore" }));

    // The nudge call must NOT expose tools (forces a plain-text closing).
    const nudgeOpts = vi.mocked(generateText).mock.calls[1]?.[0] as {
      prompt: string;
      tools?: unknown;
    };
    expect(nudgeOpts.prompt).toContain("final summary as plain text");
    expect(nudgeOpts.tools).toBeUndefined();
    expect(result.summary).toBe("found the bug in src/main.ts");
  });

  it("uses the nudge result even when the first pass had text", async () => {
    // Sanity: when the first pass HAS text, no nudge runs and that text wins.
    vi.mocked(generateText).mockResolvedValue({ text: "first-pass answer", steps: [{}] } as never);
    const result = await runSubagent(baseArgs({ type: "general" }));
    expect(result.summary).toBe("first-pass answer");
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);
  });
});

describe("DEFAULT_SUBAGENT_MODEL", () => {
  it("equals the default model id", () => {
    expect(DEFAULT_SUBAGENT_MODEL).toBe(DEFAULT_MODEL_ID);
  });
});

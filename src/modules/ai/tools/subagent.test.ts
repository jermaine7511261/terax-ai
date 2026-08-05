// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mutable state the store mocks hand out. vi.mock factories are hoisted
// above imports, so the state is declared with vi.hoisted to be referenceable.
const mocks = vi.hoisted(() => {
  const h: {
    chat: {
      apiKeys: Record<string, string>;
      selectedModelId: string;
      customEndpointKeys: Record<string, string>;
      patchAgentMeta: (meta: { step: string }) => void;
    };
    prefs: { customEndpoints: unknown[] };
    lastMeta: { step: string } | null;
  } = {
    chat: {
      apiKeys: { deepseek: "sk-test" },
      selectedModelId: "deepseek-v4-flash",
      customEndpointKeys: { "compat-e1": "ck" },
      patchAgentMeta: (meta) => {
        h.lastMeta = meta;
      },
    },
    prefs: {
      customEndpoints: [
        { id: "e1", name: "E1", baseURL: "http://x", modelId: "m", contextLimit: 100 },
      ],
    },
    lastMeta: null,
  };
  return h;
});

// Mock the heavy LLM runner so buildSubagentTools' execute() can be tested
// without invoking a real model, and mock the two stores it reads from.
vi.mock("../agents/runSubagent", () => ({
  runSubagent: vi.fn(),
  DEFAULT_SUBAGENT_MODEL: "deepseek-v4-flash",
}));
vi.mock("../store/chatStore", () => ({
  useChatStore: { getState: () => mocks.chat },
}));
vi.mock("../../settings/preferences", () => ({
  usePreferencesStore: { getState: () => mocks.prefs },
}));

import { buildSubagentTools } from "./subagent";
import { runSubagent } from "../agents/runSubagent";
import { SUBAGENTS } from "../agents/registry";
import type { ToolContext } from "./context";

const ctx = {} as ToolContext;

function buildTool() {
  return buildSubagentTools(ctx).run_subagent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lastMeta = null;
  vi.mocked(runSubagent).mockResolvedValue({
    summary: "done",
    stepCount: 2,
    durationMs: 42,
  } as never);
});

describe("buildSubagentTools tool definition", () => {
  it("exposes a run_subagent tool", () => {
    const tools = buildSubagentTools(ctx);
    expect(tools).toHaveProperty("run_subagent");
  });

  it("documents every registered subagent type in the description", () => {
    const desc = buildTool().description;
    for (const type of Object.keys(SUBAGENTS)) {
      expect(desc).toContain(type);
      expect(desc).toContain(SUBAGENTS[type as keyof typeof SUBAGENTS].description);
    }
  });
});

describe("buildSubagentTools input schema", () => {
  const schema = buildTool().inputSchema;

  it("accepts a valid input with an optional description", () => {
    const ok = schema.safeParse({ type: "explore", prompt: "find it" });
    expect(ok.success).toBe(true);

    const withDesc = schema.safeParse({
      type: "explore",
      prompt: "find it",
      description: "Explore the codebase",
    });
    expect(withDesc.success).toBe(true);
  });

  it("rejects an unknown subagent type", () => {
    const r = schema.safeParse({ type: "nope", prompt: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing prompt", () => {
    const r = schema.safeParse({ type: "explore" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-string prompt", () => {
    const r = schema.safeParse({ type: "explore", prompt: 42 });
    expect(r.success).toBe(false);
  });
});

describe("buildSubagentTools approval gate", () => {
  const needsApproval = buildTool().needsApproval;

  it.each(["code", "executor"] as const)(
    "requires approval for the writable type '%s'",
    (type) => {
      expect(needsApproval({ type })).toBe(true);
    },
  );

  it.each(["explore", "code-review", "security", "general"] as const)(
    "auto-executes the read-only type '%s'",
    (type) => {
      expect(needsApproval({ type })).toBe(false);
    },
  );

  it("does not require approval when input is missing or malformed", () => {
    expect(needsApproval(undefined)).toBe(false);
    expect(needsApproval({})).toBe(false);
    expect(needsApproval({ type: 7 })).toBe(false);
  });
});

describe("buildSubagentTools execute", () => {
  it("forwards state + ctx to runSubagent and shapes the result", async () => {
    const tool = buildTool();
    const result = await tool.execute({
      type: "explore",
      prompt: "inspect",
      description: "Look around",
    });

    expect(vi.mocked(runSubagent)).toHaveBeenCalledWith({
      type: "explore",
      prompt: "inspect",
      keys: mocks.chat.apiKeys,
      modelId: mocks.chat.selectedModelId,
      customEndpoints: mocks.prefs.customEndpoints,
      customEndpointKeys: mocks.chat.customEndpointKeys,
      toolContext: ctx,
      onStep: expect.any(Function),
    });

    expect(result).toEqual({
      type: "explore",
      description: "Look around",
      summary: "done",
      stepCount: 2,
      durationMs: 42,
    });
  });

  it("routes step labels into patchAgentMeta", async () => {
    const tool = buildTool();
    await tool.execute({ type: "explore", prompt: "inspect" });

    const onStep = vi.mocked(runSubagent).mock.calls[0][0].onStep;
    expect(typeof onStep).toBe("function");
    onStep?.("explore: read_file");
    expect(mocks.lastMeta).toEqual({ step: "explore: read_file" });
  });

  it("returns an error object when runSubagent throws", async () => {
    vi.mocked(runSubagent).mockRejectedValue(new Error("boom"));
    const tool = buildTool();

    const result = await tool.execute({ type: "executor", prompt: "run" });

    expect(result).toEqual({ error: "Error: boom", type: "executor" });
  });
});

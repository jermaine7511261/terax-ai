import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ customEndpoints: [] }),
    subscribe: () => () => undefined,
  },
}));

vi.mock("../store/chatStore", () => ({
  useChatStore: {
    getState: () => ({ apiKeys: {}, selectedModelId: "test", customEndpointKeys: {} }),
  },
}));

vi.mock("../store/agentActivityStore", () => ({
  newActivityId: () => `act-${Math.random().toString(36).slice(2, 8)}`,
  useAgentActivityStore: {
    getState: () => ({
      start: () => {},
      finish: () => {},
      fail: () => {},
      updateStep: () => {},
    }),
  },
}));

import { buildDeepSearchTools } from "./deepSearch";

const ctx = {
  getCwd: () => "/cwd",
  getWorkspaceRoot: () => "/root",
} as never;

type SubagentResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
  truncated: boolean;
};

function makeRunner(
  planSummary: string,
  researchSummary: string,
  verifySummary: string,
) {
  return {
    runSubagent: vi.fn(async (args: { prompt: string }) => {
      const p = args.prompt;
      if (p.includes("research-planner")) {
        return { summary: planSummary, stepCount: 1, durationMs: 1, truncated: false } as SubagentResult;
      }
      if (p.includes("evidence-verifier")) {
        return { summary: verifySummary, stepCount: 1, durationMs: 1, truncated: false } as SubagentResult;
      }
      // researcher
      return { summary: researchSummary, stepCount: 1, durationMs: 1, truncated: false } as SubagentResult;
    }),
  };
}

describe("deep_search tool", () => {
  it("rejects empty query", async () => {
    const tools2 = buildDeepSearchTools(ctx as never, makeRunner("", "", ""));
    const ex = tools2.deep_search.execute as unknown as (args: {
      query: string;
    }) => Promise<Record<string, unknown>>;
    const res = await ex({ query: "   " });
    expect(res).toHaveProperty("error");
  });

  it("returns partial when research yields no claims", async () => {
    const tools2 = buildDeepSearchTools(
      ctx as never,
      makeRunner(
        '{"questions":["q1"]}',
        '{"claims":[],"uncertainties":[]}',
        '{"verdicts":[]}',
      ),
    );
    const ex = tools2.deep_search.execute as unknown as (args: {
      query: string;
    }) => Promise<Record<string, unknown>>;
    const res = await ex({ query: "test" });
    expect(res.status).toBe("partial");
    expect(res.report as string).toContain("No supported factual answer");
  });

  it("produces a verified report with claims", async () => {
    const tools2 = buildDeepSearchTools(
      ctx as never,
      makeRunner(
        '{"questions":["q1","q2"]}',
        '{"claims":[{"claim":"A","evidence":"e","source_title":"t","source_locator":"u"}],"uncertainties":[]}',
        '{"verdicts":[{"claim_id":"claim-0","supported":true,"reason":"ok"},{"claim_id":"claim-1","supported":true,"reason":"ok"}]}',
      ),
    );
    const ex = tools2.deep_search.execute as unknown as (args: {
      query: string;
      breadth?: number;
    }) => Promise<Record<string, unknown>>;
    const res = await ex({ query: "test", breadth: 2 });
    expect(res.status).toBe("verified");
    expect(res.verifiedClaimIds as string[]).toEqual(["claim-0", "claim-1"]);
    expect(res.report as string).toContain("A [untrusted: web] [S1]");
    expect(res.report as string).toContain("t: u");
  });

  it("parses fenced JSON from subagents", async () => {
    const tools2 = buildDeepSearchTools(
      ctx as never,
      makeRunner(
        '```json\n{"questions":["q1"]}\n```',
        '```json\n{"claims":[{"claim":"A","evidence":"e","source_title":"t","source_locator":"u"}],"uncertainties":[]}\n```',
        '```json\n{"verdicts":[{"claim_id":"claim-0","supported":true,"reason":"ok"}]}\n```',
      ),
    );
    const ex = tools2.deep_search.execute as unknown as (args: {
      query: string;
    }) => Promise<Record<string, unknown>>;
    const res = await ex({ query: "test" });
    expect(res.status).toBe("verified");
    expect((res.verifiedClaimIds as string[]).length).toBe(1);
  });

  it("spawns one independent researcher worker per question (wave batching)", async () => {
    const runner = makeRunner(
      '{"questions":["q1","q2","q3","q4","q5","q6","q7"]}',
      '{"claims":[{"claim":"A","evidence":"e","source_title":"t","source_locator":"u"}],"uncertainties":[]}',
      '{"verdicts":[]}',
    );
    const tools2 = buildDeepSearchTools(ctx as never, runner);
    const ex = tools2.deep_search.execute as unknown as (args: {
      query: string;
      breadth?: number;
    }) => Promise<Record<string, unknown>>;
    await ex({ query: "test", breadth: 6 });

    const researcherCalls = runner.runSubagent.mock.calls.filter(
      ([args]) => (args.prompt as string).includes("researcher"),
    );
    // One call per question (breadth capped at 6 > MAX_PARALLEL_WORKERS=4,
    // so 6 questions run across 2 waves), regardless of wave grouping.
    expect(researcherCalls).toHaveLength(6);
    // Each worker carries EXACTLY one question (singular <question> tag), not
    // the whole batched question list.
    for (const [args] of researcherCalls) {
      const prompt = args.prompt as string;
      expect(prompt.match(/<question>/g) ?? []).toHaveLength(1);
      expect(prompt).not.toContain("<questions>");
    }
  });

  it("isolates a failing researcher worker without failing the research phase", async () => {
    const runner = {
      runSubagent: vi.fn(async (args: { prompt: string }) => {
        const p = args.prompt;
        if (p.includes("research-planner")) {
          return { summary: '{"questions":["q1","q2"]}', stepCount: 1, durationMs: 1, truncated: false } as SubagentResult;
        }
        if (p.includes("evidence-verifier")) {
          return { summary: '{"verdicts":[]}', stepCount: 1, durationMs: 1, truncated: false } as SubagentResult;
        }
        // researcher: first question's worker throws, second succeeds.
        if (p.includes("q1")) throw new Error("researcher boom");
        return { summary: '{"claims":[{"claim":"A","evidence":"e","source_title":"t","source_locator":"u"}],"uncertainties":[]}', stepCount: 1, durationMs: 1, truncated: false } as SubagentResult;
      }),
    };
    const tools2 = buildDeepSearchTools(ctx as never, runner);
    const ex = tools2.deep_search.execute as unknown as (args: {
      query: string;
    }) => Promise<Record<string, unknown>>;
    const res = await ex({ query: "test" });

    // Not thrown — the run resolves to a partial result and records the failure.
    expect(res.status).toBe("partial");
    expect(res.ok).toBe(false);
    expect((res.coverageNotes as string[]).some((n) => n.includes("failed"))).toBe(true);
  });
});

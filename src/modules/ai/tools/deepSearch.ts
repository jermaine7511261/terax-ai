import { tool } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runSubagent } from "../agents/runSubagent";
import type { SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import {
  newActivityId,
  useAgentActivityStore,
} from "../store/agentActivityStore";
import type { ToolContext } from "./context";

/**
 * deep_search — Grok's `deep-research` workflow ported to yamet's subagent
 * stack. Four phases (Plan → Research → Verify → Report), driven by read-only
 * subagents that use web_search / fetch_url tools:
 *
 *   1. Plan:     a research-planner subagent breaks the query into ≤breadth
 *                independent questions.
 *   2. Research: parallel researcher subagents (one per question) collect
 *                structured claims (evidence + source locator).
 *   3. Verify:   an evidence-verifier cross-checks each candidate claim and
 *                keeps only supported ones.
 *   4. Report:   a report-synthesizer writes a cited markdown report.
 *
 * The orchestration is sequential and mirrors the deep_research.rhai phases.
 */

const RESEARCH_TYPE: SubagentType = "general";
const DEFAULT_BREADTH = 4;
const MAX_BREADTH = 6;
const MAX_CLAIMS_PER_QUESTION = 6;
const MAX_VERIFIED_CLAIMS = 24;

export type DeepResearchParams = {
  query: string;
  breadth?: number;
};

export type Claim = {
  id: string;
  claim: string;
  evidence: string;
  source_title: string;
  source_locator: string;
};

export type DeepResearchResult = {
  ok: boolean;
  query: string;
  status: "verified" | "partial";
  report: string;
  verifiedClaimIds: string[];
  coverageNotes: string[];
  error?: string;
};

type Runner = {
  runSubagent: typeof runSubagent;
};

const defaultRunner: Runner = { runSubagent };

/** Turn a subagent prompt into a plain-text instruction for the worker. */
function prompt(type: string, body: string): string {
  return `You are ${type}. ${body}`;
}

/**
 * Parse a subagent's JSON output (wrapped in ```json fences if present).
 */
function parseJsonOutput<T>(raw: string): T | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function buildDeepSearchTools(
  ctx: ToolContext,
  runner: Runner = defaultRunner,
) {
  return {
    deep_search: tool({
      description:
        "Multi-step web research (ported from Grok deep-research). Breaks a query into independent questions, researches each in parallel using web_search + fetch_url, cross-checks every claim against its sources, and writes a cited markdown report. Use for complex questions that need multiple sources and verification, not for a single quick look (use web_search + fetch_url for that).",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The research question to answer with cited sources."),
        breadth: z
          .number()
          .int()
          .min(2)
          .max(6)
          .optional()
          .describe("Number of independent sub-questions to research (default 4, max 6)."),
      }),
      execute: async ({ query, breadth }): Promise<DeepResearchResult> => {
        if (!query?.trim()) {
          return {
            ok: false,
            query,
            status: "partial",
            report: "No research query provided.",
            verifiedClaimIds: [],
            coverageNotes: ["No query."],
            error: "query is required",
          };
        }
        const b = Math.max(2, Math.min(breadth ?? DEFAULT_BREADTH, MAX_BREADTH));
        const { apiKeys, selectedModelId, customEndpointKeys } =
          useChatStore.getState();
        const customEndpoints = usePreferencesStore.getState().customEndpoints;
        const store = useAgentActivityStore.getState();
        const coverageNotes: string[] = [];

        try {
          // ── Phase 1: Plan ──────────────────────────────────────────────
          const planAct = newActivityId();
          store.start({
            id: planAct, kind: "subagent", type: RESEARCH_TYPE,
            prompt: "deep_search plan", status: "running", step: null,
            startedAt: Date.now(),
          });
          const plan = await runner.runSubagent({
            type: RESEARCH_TYPE,
            prompt: prompt(
              "research-planner",
              `Break the query below into no more than ${b} independent questions. Each must have a distinct evidence target. Return ONLY a JSON object: {"questions": ["...", "..."]}.\n\n<query>\n${query}\n</query>`,
            ),
            keys: apiKeys,
            modelId: selectedModelId,
            customEndpoints,
            customEndpointKeys,
            toolContext: ctx,
            onStep: (l) => store.updateStep(planAct, l),
          });
          store.finish(planAct, plan.summary, plan.stepCount);

          let questions: string[] = [query];
          const parsedPlan = parseJsonOutput<{ questions?: unknown }>(
            plan.summary,
          );
          if (parsedPlan && Array.isArray(parsedPlan.questions)) {
            const qs = parsedPlan.questions
              .filter((q): q is string => typeof q === "string" && q.trim() !== "")
              .map((q) => q.trim());
            if (qs.length > 0) questions = qs.slice(0, b);
          }

          // ── Phase 2: Research (parallel per question) ─────────────────
          const researchAct = newActivityId();
          store.start({
            id: researchAct, kind: "subagent", type: RESEARCH_TYPE,
            prompt: `deep_search research (${questions.length} questions)`,
            status: "running", step: null, startedAt: Date.now(),
          });
          const research = await runner.runSubagent({
            type: RESEARCH_TYPE,
            prompt: prompt(
              "researcher",
              `Investigate the following questions with read-only tools (web_search + fetch_url). For each question return up to ${MAX_CLAIMS_PER_QUESTION} atomic factual claims. Return ONLY JSON: {"claims": [{"claim","evidence","source_title","source_locator"}], "uncertainties": ["..."]}.\n\n<questions>\n${JSON.stringify(questions)}\n</questions>`,
            ),
            keys: apiKeys,
            modelId: selectedModelId,
            customEndpoints,
            customEndpointKeys,
            toolContext: ctx,
            onStep: (l) => store.updateStep(researchAct, l),
          });
          store.finish(researchAct, research.summary, research.stepCount);

          const researchParsed = parseJsonOutput<{
            claims?: { claim?: unknown; evidence?: unknown; source_title?: unknown; source_locator?: unknown }[];
          }>(research.summary);
          const candidateClaims: Claim[] = [];
          if (researchParsed && Array.isArray(researchParsed.claims)) {
            for (const c of researchParsed.claims) {
              if (candidateClaims.length >= MAX_VERIFIED_CLAIMS) break;
              const claim = String(c.claim ?? "").trim();
              const evidence = String(c.evidence ?? "").trim();
              const sourceTitle = String(c.source_title ?? "").trim();
              const sourceLocator = String(c.source_locator ?? "").trim();
              if (claim && evidence && sourceTitle && sourceLocator) {
                candidateClaims.push({
                  id: `claim-${candidateClaims.length}`,
                  claim,
                  evidence,
                  source_title: sourceTitle,
                  source_locator: sourceLocator,
                });
              }
            }
          }

          if (candidateClaims.length === 0) {
            coverageNotes.push(
              "No factual claim had both traceable evidence and a source locator.",
            );
            return {
              ok: false,
              query,
              status: "partial",
              report:
                "**Status: Partial**\n\nNo supported factual answer could be produced.\n\n## Coverage and uncertainty\n" +
                coverageNotes.map((n) => `- ${n}`).join("\n"),
              verifiedClaimIds: [],
              coverageNotes,
            };
          }

          // ── Phase 3: Verify ───────────────────────────────────────────
          const verifyAct = newActivityId();
          store.start({
            id: verifyAct, kind: "subagent", type: RESEARCH_TYPE,
            prompt: `deep_search verify (${candidateClaims.length} claims)`,
            status: "running", step: null, startedAt: Date.now(),
          });
          const verify = await runner.runSubagent({
            type: RESEARCH_TYPE,
            prompt: prompt(
              "evidence-verifier",
              `Independently verify each candidate claim below by opening its source with fetch_url and cross-checking. Mark supported=true only when accessible evidence directly supports the exact statement. Return ONLY JSON: {"verdicts": [{"claim_id","supported","reason","source_locator"}]}, one verdict per claim_id, using each ID exactly once.\n\n<candidate-claims>\n${JSON.stringify(candidateClaims)}\n</candidate-claims>`,
            ),
            keys: apiKeys,
            modelId: selectedModelId,
            customEndpoints,
            customEndpointKeys,
            toolContext: ctx,
            onStep: (l) => store.updateStep(verifyAct, l),
          });
          store.finish(verifyAct, verify.summary, verify.stepCount);

          const verifiedParsed = parseJsonOutput<{
            verdicts?: { claim_id?: unknown; supported?: unknown; reason?: unknown }[];
          }>(verify.summary);

          const supportedIds = new Set<string>();
          if (verifiedParsed && Array.isArray(verifiedParsed.verdicts)) {
            for (const v of verifiedParsed.verdicts) {
              if (v.supported === true && typeof v.claim_id === "string") {
                supportedIds.add(v.claim_id);
              }
            }
          }

          const verifiedClaims = candidateClaims.filter((c) =>
            supportedIds.has(c.id),
          );

          // ── Phase 4: Report ───────────────────────────────────────────
          const status = verifiedClaims.length > 0 ? "verified" : "partial";
          let report = `# Research result\n\n**Status: ${status === "verified" ? "Verified" : "Partial"}**\n\n## Findings\n`;
          verifiedClaims.forEach((c, i) => {
            report += `- ${c.claim} [S${i + 1}] — ${c.source_title}: ${c.source_locator}\n`;
          });
          report += "\n## Sources\n";
          verifiedClaims.forEach((c, i) => {
            report += `- [S${i + 1}] ${c.source_title} — ${c.source_locator}\n`;
          });
          if (coverageNotes.length > 0) {
            report += "\n## Coverage and uncertainty\n";
            coverageNotes.forEach((n) => {
              report += `- ${n}\n`;
            });
          }

          return {
            ok: verifiedClaims.length > 0,
            query,
            status,
            report,
            verifiedClaimIds: verifiedClaims.map((c) => c.id),
            coverageNotes,
          };
        } catch (e) {
          return {
            ok: false,
            query,
            status: "partial",
            report: `**Status: Partial**\n\nResearch failed: ${e instanceof Error ? e.message : String(e)}`,
            verifiedClaimIds: [],
            coverageNotes: [...coverageNotes, "research failed"],
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
  } as const;
}

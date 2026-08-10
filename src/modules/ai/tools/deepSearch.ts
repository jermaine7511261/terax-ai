import { tool } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runSubagent } from "../agents/runSubagent";
import type { SubagentType } from "../agents/registry";
import { fastContextPrompt } from "../lib/fastContext";
import { native } from "../lib/native";
import { useChatStore } from "../store/chatStore";
import {
  newActivityId,
  useAgentActivityStore,
} from "../store/agentActivityStore";
import type { ToolContext } from "./context";

/**
 * deep_search — 's `deep-research` workflow ported to YaMet's subagent
 * stack. Four phases (Plan → Research → Verify → Report), driven by read-only
 * subagents that use web_search / fetch_url tools:
 *
 *   1. Plan:     a research-planner subagent breaks the query into ≤breadth
 *                independent questions.
 *   2. Research: researcher subagents run in parallel waves of
 *                MAX_PARALLEL_WORKERS (4), each worker handling one question.
 *                Workers within a wave run concurrently via Promise.all; waves
 *                are processed sequentially to avoid provider saturation.
 *   3. Verify:   an evidence-verifier cross-checks each candidate claim and
 *                keeps only supported ones.  Candidate claims carry an
 *                [untrusted: web] trust-boundary annotation since their
 *                evidence originates from internet search results.
 *   4. Report:   a report-synthesizer writes a cited markdown report.
 *
 * The orchestration is sequential and mirrors the deep_research.rhai phases.
 */

const RESEARCH_TYPE: SubagentType = "general";
const DEFAULT_BREADTH = 4;
const MAX_BREADTH = 6;
const MAX_CLAIMS_PER_QUESTION = 6;
const MAX_VERIFIED_CLAIMS = 24;
/** Concurrency cap for Phase 2 researcher workers (mirrors delegate_many's
 *  MAX_PARALLEL_WORKERS). Kept local — importing delegateMany would create a
 *  circular dependency — so research waves slice questions in batches of 4. */
const MAX_PARALLEL_WORKERS = 4;

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
  /** Trust boundary: "web" = from internet search, "local" = from workspace. */
  trust: string;
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

/**
 * S2 guardrail: validate that the verifier's verdicts satisfy the exact-ID
 * completeness invariant — every candidate claim_id must appear exactly once
 * in the verdicts array.  Returns the set of supported claim_ids, or null if
 * the verdicts are malformed (caller should treat as partial).
 */
function reconcileVerdicts(
  candidateIds: string[],
  verdicts: { claim_id?: unknown; supported?: unknown; reason?: unknown }[],
): { supportedIds: Set<string>; missingIds: string[]; duplicateIds: string[] } | null {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return null;

  const seen = new Map<string, boolean>();
  const missingIds: string[] = [];
  const duplicateIds: string[] = [];

  for (const v of verdicts) {
    if (typeof v.claim_id !== "string") continue;
    if (seen.has(v.claim_id)) {
      duplicateIds.push(v.claim_id);
    }
    seen.set(v.claim_id, v.supported === true);
  }

  for (const id of candidateIds) {
    if (!seen.has(id)) missingIds.push(id);
  }

  // If there are missing or duplicate IDs, the verdicts are incomplete.
  if (missingIds.length > 0 || duplicateIds.length > 0) {
    return { supportedIds: new Set(), missingIds, duplicateIds };
  }

  const supportedIds = new Set<string>();
  for (const [id, supported] of seen) {
    if (supported) supportedIds.add(id);
  }
  return { supportedIds, missingIds, duplicateIds };
}

export function buildDeepSearchTools(
  ctx: ToolContext,
  runner: Runner = defaultRunner,
) {
  return {
    deep_search: tool({
      description:
        "Multi-step web research (ported from  deep-research). Breaks a query into independent questions, researches each in parallel using web_search + fetch_url, cross-checks every claim against its sources, and writes a cited markdown report. Use for complex questions that need multiple sources and verification, not for a single quick look (use web_search + fetch_url for that).",
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

        // Rust-backed session: budget tracking + B14 claim validation.
        let rustSessionId: number | null = null;
        try {
          rustSessionId = await native.deepSearchStart({ query, breadth: b });
        } catch {
          // Rust session is optional — if it fails, fall through to TS-only path.
        }

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
          } else {
            coverageNotes.push("planner did not return a parseable question list; falling back to the raw query.");
          }

          // Advance Rust session: Plan → Research.
          if (rustSessionId !== null) {
            try {
              await native.deepSearchAdvance({ id: rustSessionId, coverageNotes });
            } catch { /* best-effort */ }
          }

          // ── Phase 2: Research (parallel per question, wave = MAX_PARALLEL_WORKERS) ──
          // Each question is delegated to its own isolated researcher worker so
          // independent questions research concurrently. Workers are batched
          // into waves of MAX_PARALLEL_WORKERS (a simple semaphore, mirroring
          // delegate_many's fan-out) so a large question list can't saturate the
          // provider. One research activity id tracks the whole phase; step
          // labels carry the worker index.

          // Reserve Rust budget for parallel workers.
          if (rustSessionId !== null) {
            try {
              await native.deepSearchReserve(rustSessionId, questions.length);
            } catch { /* best-effort */ }
          }

          const researchAct = newActivityId();
          store.start({
            id: researchAct, kind: "subagent", type: RESEARCH_TYPE,
            prompt: `deep_search research (${questions.length} questions)`,
            status: "running", step: null, startedAt: Date.now(),
          });
          const researcherPrompt = (question: string) =>
            prompt(
              "researcher",
              `Investigate the following question with read-only tools (web_search + fetch_url). ${fastContextPrompt()} For the question return up to ${MAX_CLAIMS_PER_QUESTION} atomic factual claims. IMPORTANT: You MUST return ONLY a valid JSON object matching this exact schema — no markdown fences, no commentary, no text before or after:\n{"claims":[{"claim":"string","evidence":"string","source_title":"string","source_locator":"string","trust":"web"}],"uncertainties":["string"]}\nEach claim must have trust="web" since evidence comes from internet search results.\n\n<question>\n${question}\n</question>`,
            );

          const candidateClaims: Claim[] = [];
          for (
            let waveStart = 0;
            waveStart < questions.length;
            waveStart += MAX_PARALLEL_WORKERS
          ) {
            const wave = questions.slice(
              waveStart,
              waveStart + MAX_PARALLEL_WORKERS,
            );
            // Isolate per-worker failures (catch each promise) so one bad
            // researcher can't fail the whole research phase — it is recorded
            // in coverageNotes and the remaining questions still resolve.
            const waveClaims = await Promise.all(
              wave.map(async (question, i) => {
                const workerIdx = waveStart + i + 1;
                store.updateStep(
                  researchAct,
                  `question ${workerIdx}/${questions.length}`,
                );
                try {
                  const r = await runner.runSubagent({
                    type: RESEARCH_TYPE,
                    prompt: researcherPrompt(question),
                    keys: apiKeys,
                    modelId: selectedModelId,
                    customEndpoints,
                    customEndpointKeys,
                    toolContext: ctx,
                    onStep: (l) =>
                      store.updateStep(researchAct, `q${workerIdx}: ${l}`),
                  });
                  const parsed = parseJsonOutput<{
                    claims?: {
                      claim?: unknown;
                      evidence?: unknown;
                      source_title?: unknown;
                      source_locator?: unknown;
                      trust?: unknown;
                    }[];
                  }>(r.summary);
                  if (parsed && Array.isArray(parsed.claims)) {
                    return parsed.claims;
                  }
                  coverageNotes.push(
                    `researcher for question ${workerIdx} did not return parseable claims; skipping.`,
                  );
                  return [];
                } catch (e) {
                  coverageNotes.push(
                    `researcher for question ${workerIdx} failed: ${e instanceof Error ? e.message : String(e)}`,
                  );
                  return [];
                }
              }),
            );
            // Merge this wave's claims into the running candidate set.
            for (const claims of waveClaims) {
              for (const c of claims) {
                if (candidateClaims.length >= MAX_VERIFIED_CLAIMS) break;
                const claim = String(c.claim ?? "").trim();
                const evidence = String(c.evidence ?? "").trim();
                const sourceTitle = String(c.source_title ?? "").trim();
                const sourceLocator = String(c.source_locator ?? "").trim();
                const trust = String(c.trust ?? "web").trim();
                if (claim && evidence && sourceTitle && sourceLocator) {
                  candidateClaims.push({
                    id: `claim-${candidateClaims.length}`,
                    claim,
                    evidence,
                    source_title: sourceTitle,
                    source_locator: sourceLocator,
                    trust,
                  });
                }
              }
            }
          }
          store.finish(
            researchAct,
            `researched ${questions.length} questions, ${candidateClaims.length} candidate claims`,
            questions.length,
          );

          // Advance Rust session: Research → Verify, with candidates.
          if (rustSessionId !== null) {
            try {
              await native.deepSearchAdvance({
                id: rustSessionId,
                candidates: candidateClaims.map((c) => ({
                  id: c.id,
                  claim: c.claim,
                  evidence: c.evidence,
                  source_title: c.source_title,
                  source_locator: c.source_locator,
                })),
                coverageNotes,
              });
            } catch { /* best-effort */ }
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
              `Independently verify each candidate claim below by opening its source with fetch_url and cross-checking. Mark supported=true only when accessible evidence directly supports the exact statement. CRITICAL: Return ONLY a valid JSON object matching this exact schema — no markdown fences, no commentary, no text before or after:\n{"verdicts":[{"claim_id":"claim-0","supported":true,"reason":"string","source_locator":"string"}]}\nYou MUST include exactly one verdict per claim_id, using each ID exactly once. Every candidate claim_id must appear in your verdicts — no IDs may be missing or duplicated.\n\n<candidate-claims>\n${JSON.stringify(candidateClaims)}\n</candidate-claims>`,
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

          // S2 guardrail: exact-ID completeness check.
          // Every candidate claim_id must appear exactly once in the verdicts.
          const candidateIds = candidateClaims.map((c) => c.id);
          const supportedIds = new Set<string>();
          if (verifiedParsed && Array.isArray(verifiedParsed.verdicts)) {
            const result = reconcileVerdicts(candidateIds, verifiedParsed.verdicts);
            if (result) {
              if (result.missingIds.length > 0) {
                coverageNotes.push(
                  `verifier missed ${result.missingIds.length} claim(s): ${result.missingIds.join(", ")}`,
                );
              }
              if (result.duplicateIds.length > 0) {
                coverageNotes.push(
                  `verifier duplicated ${result.duplicateIds.length} claim(s): ${result.duplicateIds.join(", ")}`,
                );
              }
              for (const id of result.supportedIds) {
                supportedIds.add(id);
              }
            } else {
              coverageNotes.push("verifier returned malformed verdicts; treating all as rejected.");
            }
          } else {
            coverageNotes.push("verifier did not return parseable verdicts.");
          }

          const verifiedClaims = candidateClaims.filter((c) =>
            supportedIds.has(c.id),
          );

          // Advance Rust session: Verify → Done, with verified claims.
          // Rust validates B14 (verified ⊆ candidates) and synthesizes the report.
          if (rustSessionId !== null) {
            try {
              const rustResult = await native.deepSearchAdvance({
                id: rustSessionId,
                verified: verifiedClaims.map((c) => ({
                  id: c.id,
                  claim: c.claim,
                  evidence: c.evidence,
                  source_title: c.source_title,
                  source_locator: c.source_locator,
                })),
                coverageNotes,
              });
              // Use Rust-generated report if available (it includes proper formatting).
              if (rustResult.report) {
                return {
                  ok: verifiedClaims.length > 0,
                  query,
                  status: verifiedClaims.length > 0 ? "verified" : "partial",
                  report: rustResult.report,
                  verifiedClaimIds: verifiedClaims.map((c) => c.id),
                  coverageNotes,
                };
              }
            } catch { /* fall through to TS report */ }
          }

          // ── Phase 4: Report ───────────────────────────────────────────
          const status = verifiedClaims.length > 0 ? "verified" : "partial";
          let report = `# Research result\n\n**Status: ${status === "verified" ? "Verified" : "Partial"}**\n\n## Findings\n`;
          verifiedClaims.forEach((c, i) => {
            const trustTag = c.trust === "web" ? " [untrusted: web]" : "";
            report += `- ${c.claim}${trustTag} [S${i + 1}] — ${c.source_title}: ${c.source_locator}\n`;
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
          // Abort Rust session on failure.
          if (rustSessionId !== null) {
            try { await native.deepSearchAbort(rustSessionId); } catch { /* best-effort */ }
          }
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

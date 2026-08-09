import { generateText, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, type CustomEndpoint, type ModelId } from "../config";
import { buildConfiguredLanguageModel } from "../lib/agent";
import { capSummary, PROSE_SUMMARY_CAP } from "../lib/summary";
import type { CustomEndpointKeys, ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildEditTools } from "../tools/edit";
import { buildFsTools } from "../tools/fs";
import { buildGitTools } from "../tools/git";
import { buildNetTools } from "../tools/net";
import { buildSearchTools } from "../tools/search";
import { buildShellTools } from "../tools/shell";
import { CLOSING_RULE, SUBAGENTS, type SubagentType } from "./registry";

/** Default step cap for a subagent run. Overridable per-call (`maxSteps`).
 *  Raised from 12 so research/audit workers can complete; the parent's
 *  budgets + timeouts still bound the run. */
const SUBAGENT_MAX_STEPS = 40;

/** Per-request retry (network blips / provider 5xx). Default is 2; subagents
 *  get a bounded retry so a single transient failure doesn't fail the whole
 *  delegated task. */
const SUBAGENT_MAX_RETRIES = 1;

/** Total wall-clock cap for a subagent run. Prevents a stuck model / slow
 *  reasoning model from hanging the parent forever (the "always times out"
 *  symptom). 5 minutes is generous for a 12-step tool loop. */
const SUBAGENT_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;

/** Per-step cap: a single model response (streaming) must make progress within
 *  this window or the step aborts. Guards against a provider that accepts the
 *  connection but never sends tokens. */
const SUBAGENT_STEP_TIMEOUT_MS = 90 * 1000;

/** Hard ceiling on the delegation depth ( `subagents_max_depth` / 
 * `max_spawn_depth`). A subagent's workers inherit depth+1; beyond this the
 * delegate_many tool refuses to spawn deeper. */
export const MAX_SPAWN_DEPTH = 3;

/** Prose summary budget cap ( summary-budget-cap), applied via
 * `capSummary`: prose is cut at a sentence boundary, and structured output
 * (deep_search researcher/verifier JSON) is never clipped at a prose boundary. */
export const SUBAGENT_SUMMARY_CAP = PROSE_SUMMARY_CAP;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  modelId: string;
  toolContext: ToolContext;
  llamaCppBaseURL?: string;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  onStep?: (label: string) => void;
  /**
   * Optional isolated context to inject ahead of the prompt (P1-2 / 
   * task_result). The child has NO shared parent history — this is the only
   * context it carries beyond its own system prompt + tools.
   */
  context?: string;
  /** R28 #15: bound knowledge source content injected ahead of the task. */
  knowledge?: string;
  /** R28 #1: step cap override for this subagent (None = the 40 default). */
  maxSteps?: number;
  /** Delegation depth of this worker (root parent = 0). Guards infinite nesting. */
  depth?: number;
  /** Parent activity/session id for the UI tree ( parentID). */
  parentId?: string;
};

type RunResult = {
  summary: string;
  /** True when the summary was truncated by the budget cap. */
  truncated: boolean;
  stepCount: number;
  durationMs: number;
};

/**
 * ai SDK blocks tools with `needsApproval: true` inside `generateText` (it
 * collects them as approval requests and never executes them). Subagents have
 * no UI approval channel, so writable subagents must run their mutating tools
 * unblocked — the approval happens once, on the `run_subagent` tool call itself.
 */
function stripApproval(tool: unknown): unknown {
  if (tool && typeof tool === "object") {
    const { needsApproval: _needsApproval, ...rest } = tool as Record<
      string,
      unknown
    >;
    return rest;
  }
  return tool;
}

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  llamaCppBaseURL,
  customEndpoints,
  customEndpointKeys,
  onStep,
  context,
  knowledge,
  maxSteps,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);
  // Closing rule (registry.ts): the final message must be plain text. This
  // prevents the "ends on a tool call → empty summary" failure at the source.
  const system = `${def.systemPrompt}${CLOSING_RULE}`;

  // Independent context (P1-2): the child carries only its system prompt,
  // the caller-supplied context (if any), and the task prompt — never the
  // parent's shared message history.
  let taskPrompt =
    context && context.trim().length > 0
      ? `${context.trim()}\n\n${prompt}`
      : prompt;
  // R28 #15 per-agent knowledge: inject bound knowledge ahead of the task.
  if (knowledge && knowledge.trim().length > 0) {
    taskPrompt = `<agent-knowledge>\n${knowledge.trim()}\n</agent-knowledge>\n\n${taskPrompt}`;
  }

  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
    // MUST 差距 1 修复: web_search/fetch_url 必须可用,否则 deep_search 的
    // researcher/verifier 研究阶段实际离线。
    ...buildNetTools(toolContext),
  };
  const writable: Record<string, unknown> = {
    ...buildEditTools(toolContext),
    ...buildGitTools(toolContext),
    ...buildShellTools(toolContext),
  };
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) tools[t] = readOnly[t];
    else if (t in writable) tools[t] = stripApproval(writable[t]);
  }

  const model = await buildConfiguredLanguageModel(modelId, keys, {
    customEndpoints,
    customEndpointKeys,
    llamaCppBaseURL,
  });

  const start = Date.now();
  // The child's own system prompt may not mandate a closing text. When the
  // loop ends on a tool-call step (cap hit or tool-heavy turn), `finalStep.text`
  // is empty and generateText returns "" — the "multi-step, no summary"
  // failure. Fix: if the run produced no final text, give the model one more
  // turn with tools removed and an explicit "output your summary" instruction
  // so a subagent ALWAYS returns something usable.
  const result = await generateText({
    model,
    system,
    prompt: taskPrompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(maxSteps ?? SUBAGENT_MAX_STEPS),
    // Bound the run: bounded retries for transient errors + explicit step and
    // total timeouts so a slow/hung model can't fail the parent forever.
    maxRetries: SUBAGENT_MAX_RETRIES,
    timeout: {
      totalMs: SUBAGENT_TOTAL_TIMEOUT_MS,
      stepMs: SUBAGENT_STEP_TIMEOUT_MS,
    },
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  const stepCount = result.steps?.length ?? 0;
  let raw = result.text;
  if (!raw || raw.trim().length === 0) {
    // No final text: retry without tools, instructing a bare summary. This is
    // the robustness guarantee — the parent always gets a usable summary.
    onStep?.(`${type}: summarizing`);
    const closing = await generateText({
      model,
      system,
      // No tools: forces a plain-text closing answer instead of another loop.
      prompt: `${taskPrompt}\n\nPlease output your final summary as plain text now. Do not call any tools. If you already found everything you need, just summarize it.`,
      maxRetries: SUBAGENT_MAX_RETRIES,
      timeout: {
        totalMs: SUBAGENT_TOTAL_TIMEOUT_MS,
        stepMs: SUBAGENT_STEP_TIMEOUT_MS,
      },
    });
    if (closing.text && closing.text.trim().length > 0) {
      raw = closing.text;
    } else {
      raw = "(no output)";
    }
  }

  // Summary budget cap (): prose is truncated at a sentence boundary;
  // structured output (deep_search JSON) is kept intact so downstream parsing
  // never silently discards a whole research phase.
  const capped = capSummary(raw, SUBAGENT_SUMMARY_CAP);

  return {
    summary: capped.text,
    truncated: capped.truncated,
    stepCount,
    durationMs: Date.now() - start,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;

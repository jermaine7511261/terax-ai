import { generateText, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, type CustomEndpoint, type ModelId } from "../config";
import { buildConfiguredLanguageModel } from "../lib/agent";
import type { CustomEndpointKeys, ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildEditTools } from "../tools/edit";
import { buildFsTools } from "../tools/fs";
import { buildGitTools } from "../tools/git";
import { buildNetTools } from "../tools/net";
import { buildSearchTools } from "../tools/search";
import { buildShellTools } from "../tools/shell";
import { CLOSING_RULE, SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

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

/** Hard ceiling on the delegation depth (grok `subagents_max_depth` / hermes
 * `max_spawn_depth`). A subagent's workers inherit depth+1; beyond this the
 * delegate_many tool refuses to spawn deeper. */
export const MAX_SPAWN_DEPTH = 3;

/** Summary budget cap (hermes summary-budget-cap): a subagent's returned
 * summary longer than this is truncated to a head excerpt + a "…" marker so a
 * parent's context can't be blown up by a child's oversized result. */
export const SUBAGENT_SUMMARY_CAP = 4000;

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
   * Optional isolated context to inject ahead of the prompt (P1-2 / opencode
   * task_result). The child has NO shared parent history — this is the only
   * context it carries beyond its own system prompt + tools.
   */
  context?: string;
  /** Delegation depth of this worker (root parent = 0). Guards infinite nesting. */
  depth?: number;
  /** Parent activity/session id for the UI tree (opencode parentID). */
  parentId?: string;
};

type RunResult = {
  summary: string;
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
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);
  // Closing rule (registry.ts): the final message must be plain text. This
  // prevents the "ends on a tool call → empty summary" failure at the source.
  const system = `${def.systemPrompt}${CLOSING_RULE}`;

  // Independent context (P1-2): the child carries only its system prompt,
  // the caller-supplied context (if any), and the task prompt — never the
  // parent's shared message history.
  const taskPrompt =
    context && context.trim().length > 0
      ? `${context.trim()}\n\n${prompt}`
      : prompt;

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
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
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

  // Summary budget cap (hermes): truncate the child's returned summary so a
  // parent's context can't be blown up by an oversized result.
  const summary =
    raw.length > SUBAGENT_SUMMARY_CAP
      ? `${raw.slice(0, SUBAGENT_SUMMARY_CAP)}…[truncated to ${SUBAGENT_SUMMARY_CAP} chars]`
      : raw;

  return {
    summary,
    stepCount,
    durationMs: Date.now() - start,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;

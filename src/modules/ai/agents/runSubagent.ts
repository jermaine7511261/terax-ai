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
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

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
  const result = await generateText({
    model,
    system: def.systemPrompt,
    prompt: taskPrompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  // Summary budget cap (hermes): truncate the child's returned summary so a
  // parent's context can't be blown up by an oversized result.
  const raw = result.text || "(no output)";
  const summary =
    raw.length > SUBAGENT_SUMMARY_CAP
      ? `${raw.slice(0, SUBAGENT_SUMMARY_CAP)}…[truncated to ${SUBAGENT_SUMMARY_CAP} chars]`
      : raw;

  return {
    summary,
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;

import { generateText, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, type CustomEndpoint, type ModelId } from "../config";
import { buildConfiguredLanguageModel } from "../lib/agent";
import type { CustomEndpointKeys, ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildEditTools } from "../tools/edit";
import { buildFsTools } from "../tools/fs";
import { buildGitTools } from "../tools/git";
import { buildSearchTools } from "../tools/search";
import { buildShellTools } from "../tools/shell";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

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
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
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
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  return {
    summary: result.text || "(no output)",
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;

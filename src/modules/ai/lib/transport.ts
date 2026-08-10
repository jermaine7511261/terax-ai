import type { UIMessage } from "@ai-sdk/react";
import type { CustomEndpoint } from "../config";
import { runAgentStream, type AgentUsageDelta } from "./agent";
import { isRetryableModelError } from "./resilience";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import type { ThinkingLength } from "@/modules/settings/store";
import { formatAiError } from "./errors";
import { native } from "./native";
import type { ToolContext } from "../tools/tools";
import {
  getSessionMemory,
  recallTop,
} from "../store/memoryStore";
import { useMcpStore } from "@/modules/mcp";

export const YAMET_MD_MAX_BYTES = 32 * 1024;
type MemoryCacheEntry = { content: string | null; mtime: number };
const projectMemoryCache = new Map<string, MemoryCacheEntry>();

export type ProjectMemoryEntry = {
  id: string;
  content: string;
  createdAt: number;
  /** Who wrote this: the agent tool (`tool`) or the auto-settle nudge (`auto`). */
  source?: "tool" | "auto";
};

const MEM_START = "<!-- YaMet-project-memory:start -->";
const MEM_END = "<!-- YaMet-project-memory:end -->";

export {
  MEMORY_NOTE,
  MEMORY_NOTE_END,
  scrubMemoryEcho,
} from "./memoryMarker";
import { MEMORY_NOTE, MEMORY_NOTE_END } from "./memoryMarker";


function memoryPath(workspaceRoot: string): string {
  return `${workspaceRoot.replace(/\/$/, "")}/YaMet.md`;
}

function invalidateCache(workspaceRoot: string): void {
  projectMemoryCache.delete(workspaceRoot);
}

export function renderEntry(e: { content: string }): string {
  return `- ${e.content.replace(/\r?\n/g, " ")}`;
}

type MemoryBlock = { prefix: string; lines: string[]; suffix: string };

export function parseBlock(content: string): MemoryBlock {
  const startIdx = content.indexOf(MEM_START);
  const endIdx = content.indexOf(MEM_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { prefix: content, lines: [], suffix: "" };
  }
  const prefix = content.slice(0, startIdx);
  const suffix = content.slice(endIdx + MEM_END.length);
  const inner = content.slice(startIdx + MEM_START.length, endIdx);
  const lines = inner.split("\n").filter((l) => l.trim().length > 0);
  return { prefix, lines, suffix };
}

export function rebuildBlock(block: MemoryBlock): string {
  let out = block.prefix;
  if (block.lines.length > 0) {
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out += `${MEM_START}\n${block.lines.join("\n")}\n${MEM_END}`;
    if (block.suffix.length > 0 && !block.suffix.startsWith("\n")) out += "\n";
  }
  out += block.suffix;
  return out;
}

function capBytes(text: string): string {
  return text.length > YAMET_MD_MAX_BYTES
    ? text.slice(0, YAMET_MD_MAX_BYTES)
    : text;
}

async function readMemoryFile(
  workspaceRoot: string,
): Promise<{ content: string; path: string }> {
  const path = memoryPath(workspaceRoot);
  try {
    const r = await native.readFile(path);
    if (r.kind === "text") return { content: r.content, path };
    return { content: "", path };
  } catch {
    return { content: "", path };
  }
}

/**
 * Append a project memory note to YaMet.md (dedup by exact content within the
 * managed block), cap to YAMET_MD_MAX_BYTES, and invalidate the read cache so
 * the next run re-reads from disk.
 */
export async function appendProjectMemory(
  workspaceRoot: string,
  entry: ProjectMemoryEntry,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const { content, path } = await readMemoryFile(workspaceRoot);
  const block = parseBlock(content);
  const line = renderEntry(entry);
  if (!block.lines.includes(line)) block.lines.push(line);
  try {
    await native.writeFile(path, capBytes(rebuildBlock(block)));
    invalidateCache(workspaceRoot);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Update (replace-or-append) a project memory note in YaMet.md, capped and
 * cache-invalidated like {@link appendProjectMemory}.
 */
export async function updateProjectMemory(
  workspaceRoot: string,
  entry: ProjectMemoryEntry,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const { content, path } = await readMemoryFile(workspaceRoot);
  const block = parseBlock(content);
  const line = renderEntry(entry);
  block.lines = block.lines.filter((l) => l !== line);
  block.lines.push(line);
  try {
    await native.writeFile(path, capBytes(rebuildBlock(block)));
    invalidateCache(workspaceRoot);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Remove a project memory entry from YaMet.md by exact content match (the
 * persisted block stores plain `- content` lines, so content is the id).
 */
export async function removeProjectMemory(
  workspaceRoot: string,
  content: string,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const { content: fileContent, path } = await readMemoryFile(workspaceRoot);
  const block = parseBlock(fileContent);
  const line = renderEntry({ content });
  const next = block.lines.filter((l) => l !== line);
  if (next.length === block.lines.length) {
    return { ok: true, path }; // nothing matched — idempotent
  }
  block.lines = next;
  try {
    await native.writeFile(path, capBytes(rebuildBlock(block)));
    invalidateCache(workspaceRoot);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Merge the static YaMet.md content with this session's in-memory notes into a
 * single block for the system prompt. Dedups identical trimmed lines and caps
 * the total at YAMET_MD_MAX_BYTES to prevent the model from growing the prompt
 * unboundedly.
 */
export function mergeProjectMemory(
  staticMd: string | null,
  sessionMd: string | null,
): string | null {
  const parts = [staticMd, sessionMd].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
  if (parts.length === 0) return null;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const line of part.split("\n")) {
      const key = line.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return capBytes(lines.join("\n"));
}

async function readYametMd(workspaceRoot: string | null): Promise<string | null> {
  if (!workspaceRoot) return null;
  const path = `${workspaceRoot.replace(/\/$/, "")}/YaMet.md`;
  const cached = projectMemoryCache.get(workspaceRoot);
  if (cached && Date.now() - cached.mtime < 30_000) return cached.content;
  try {
    const r = await native.readFile(path);
    if (r.kind !== "text") {
      projectMemoryCache.set(workspaceRoot, { content: null, mtime: Date.now() });
      return null;
    }
    const content =
      r.content.length > YAMET_MD_MAX_BYTES
        ? r.content.slice(0, YAMET_MD_MAX_BYTES)
        : r.content;
    projectMemoryCache.set(workspaceRoot, { content, mtime: Date.now() });
    return content;
  } catch {
    projectMemoryCache.set(workspaceRoot, { content: null, mtime: Date.now() });
    return null;
  }
}

type LiveSnapshot = {
  cwd: string | null;
  terminalPrivate: boolean;
  workspaceRoot: string | null;
  activeFile: string | null;
};

type Deps = {
  getKeys: () => ProviderKeys;
  toolContext: ToolContext;
  getModelId: () => string;
  getCustomInstructions: () => string;
  getAgentPersona: () => { name: string; instructions: string } | null;
  getLive: () => LiveSnapshot;
  getLlamaCppBaseURL?: () => string | undefined;
  getLlamaCppModelId?: () => string | undefined;
  getOpenaiCompatibleBaseURL?: () => string | undefined;
  getOpenaiCompatibleModelId?: () => string | undefined;
  getOpenaiCompatibleContextLimit?: () => number | undefined;
  getOpenrouterModelId?: () => string | undefined;
  getCustomEndpoints?: () => readonly CustomEndpoint[];
  getCustomEndpointKeys?: () => CustomEndpointKeys;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsageDelta) => void;
  onCompact?: (info: { droppedCount: number }) => void;
  onFinishMeta?: (info: {
    hitStepCap: boolean;
    finishReason: string;
    /** Final assistant text of THIS run (settled into auto-memory, P1-4). */
    finalText?: string;
    stepsSeen?: number;
  }) => void;
  onPhase?: (phase: "thinking" | "calling" | "observing" | "done") => void;
  onDoomLoop?: (info: {
    severity: "tool" | "approach" | "ask";
    message: string;
    detections: number;
  }) => void;
  getPlanMode?: () => boolean;
  /** Skill-scoped tool allowlist for this session (undefined = full tools). */
  getToolAllowlist?: () => string[] | undefined;
  getThinkingLength?: () => ThinkingLength | undefined;
};

type SendOptions = {
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  [k: string]: unknown;
};

/**
 * Sanitize the outbound message history against orphan tool-calls.
 *
 * A run that ends mid-tool (user abort, step cap, error before the AI SDK
 * folds a tool result back into the message) can leave an assistant message
 * carrying a `tool-call` part with NO matching `tool-result` part. When that
 * history is sent to the provider on the next turn, OpenAI-compatible APIs
 * reject it with "an assistant message with tool calls must be followed by
 * tool messages responding to each tool call id".
 *
 * We strip those orphan `tool-call` parts (and keep the sibling text) so the
 * outbound history is always well-formed. This is a defensive gate at the send
 * boundary — the stream itself is handled by the AI SDK.
 */
export function sanitizeOrphanToolCalls(messages: UIMessage[]): UIMessage[] {
  let changed = false;
  const out = messages.map((m) => {
    const parts = m.parts;
    if (!parts) return m;
    // Only assistant messages carry tool-call parts.
    if (m.role !== "assistant") return m;
    const resultIds = new Set(
      parts
        .filter((p) => p.type === "tool-result")
        .map((p) => (p as { toolCallId?: string }).toolCallId)
        .filter(Boolean),
    );
    const orphan = parts.filter(
      (p) =>
        p.type === "tool-call" &&
        !resultIds.has((p as { toolCallId?: string }).toolCallId ?? ""),
    );
    if (orphan.length === 0) return m;
    changed = true;
    const keep = parts.filter(
      (p) => !(p.type === "tool-call" && !resultIds.has((p as { toolCallId?: string }).toolCallId ?? "")),
    );
    return { ...m, parts: keep };
  });
  if (!changed) return messages;
  // Drop trailing empty assistant messages (no parts left) to keep history tidy.
  return out.filter((m) => !(m.role === "assistant" && (!m.parts || m.parts.length === 0)));
}

export function createContextAwareTransport(deps: Deps) {
  const run = async (options: SendOptions) => {
    // Refresh the dynamic MCP tool registry before every run so newly
    // connected servers appear and dropped ones disappear from the toolset.
    await useMcpStore.getState().refresh().catch(() => {});
    const live = deps.getLive();
    // P1-4 recall-based injection: instead of blindly splicing the full
    // YaMet.md + full session memory, recall only the relevant lines for the
    // latest user query and wrap them in an isolation marker (
    // select_context + build_memory_context_block).
    const staticMemory = await readYametMd(live.workspaceRoot);
    const sessionMemory = getSessionMemory(deps.toolContext.getSessionId());
    const query = lastUserText(options.messages);
    const projectMemory = buildRecalledMemory(staticMemory, sessionMemory, query);
    const envBlock = formatEnvBlock(live);
    const cleanMessages = sanitizeOrphanToolCalls(options.messages);
    const messagesForRun = envBlock
      ? injectEnvIntoLastUser(cleanMessages, envBlock)
      : cleanMessages;
    // R30 §2.1: cross-provider failover for the main chat stream. The first
    // fullStream item is probed to trigger the HTTP request; a retryable
    // failure (429/5xx/network) before any content is emitted transparently
    // re-runs the whole agent stream against the next provider in the chain.
    const fallbackChain = usePreferencesStore.getState().providerFallbackChain ?? [];
    const fallbackOrder = Array.from(new Set([deps.getModelId(), ...fallbackChain]));
    let fallbackErr: unknown;
    for (const fallbackModelId of fallbackOrder) {
      if (!(await native.resilienceAvailable(fallbackModelId))) continue;
      const result = await runAgentStream({
      keys: deps.getKeys(),
      modelId: fallbackModelId,
      customInstructions: deps.getCustomInstructions(),
      agentPersona: deps.getAgentPersona(),
      toolContext: deps.toolContext,
      onStep: deps.onStep,
      onUsage: deps.onUsage,
      onCompact: deps.onCompact,
      onFinishMeta: deps.onFinishMeta,
      onPhase: deps.onPhase,
      onDoomLoop: deps.onDoomLoop,
      llamaCppBaseURL: deps.getLlamaCppBaseURL?.(),
      llamaCppModelId: deps.getLlamaCppModelId?.(),
      openaiCompatibleBaseURL: deps.getOpenaiCompatibleBaseURL?.(),
      openaiCompatibleModelId: deps.getOpenaiCompatibleModelId?.(),
      openaiCompatibleContextLimit: deps.getOpenaiCompatibleContextLimit?.(),
      openrouterModelId: deps.getOpenrouterModelId?.(),
      customEndpoints: deps.getCustomEndpoints?.(),
      customEndpointKeys: deps.getCustomEndpointKeys?.(),
      planMode: deps.getPlanMode?.(),
      toolAllowlist: deps.getToolAllowlist?.(),
      thinkingLength: deps.getThinkingLength?.(),
      projectMemory,
      uiMessages: messagesForRun,
      abortSignal: options.abortSignal,
    });
      if (!result.fullStream) {
        return result.toUIMessageStream({
          originalMessages: options.messages,
          onError: formatAiError,
        });
      }
      try {
        const streamSrc = result.fullStream as unknown as AsyncIterable<unknown>;
        const it = streamSrc[Symbol.asyncIterator]();
        const first = await it.next();
        if (first.done) {
          return result.toUIMessageStream({
            originalMessages: options.messages,
            onError: formatAiError,
          });
        }
        const fullStream = (async function* () {
          yield first.value;
          for (let n = await it.next(); !n.done; n = await it.next()) {
            yield n.value;
          }
        })();
        const merged = Object.create(Object.getPrototypeOf(result));
        Object.assign(merged, result);
        Object.defineProperty(merged, "fullStream", {
          value: fullStream,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        void native.resilienceRecordSuccess(fallbackModelId);
        return merged.toUIMessageStream({
          originalMessages: options.messages,
          onError: formatAiError,
        });
      } catch (e) {
        fallbackErr = e;
        void native.resilienceRecordFailure(fallbackModelId);
        if (!isRetryableModelError(e)) throw e;
        console.warn(
          `[resilience] chat fallback: provider ${fallbackModelId} failed (${String(e)})`,
        );
      }
    }
    throw fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
  };

  return {
    sendMessages: run,
    async reconnectToStream(): Promise<null> {
      return null;
    },
  };
}

/** Extract the latest user text part for recall querying. */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const parts = m.parts as ReadonlyArray<{ type: string; text?: string }>;
    for (let j = parts.length - 1; j >= 0; j--) {
      if (parts[j].type === "text" && parts[j].text) return parts[j].text ?? "";
    }
  }
  return "";
}

/**
 * P1-4 recall-based memory injection: rank the combined static YaMet.md lines
 * + session-memory entries against the user query, keep only the relevant hits,
 * and wrap them in an isolation marker. Returns null when nothing relevant (or
 * no memory exists) — keeping the prompt lean instead of splicing full memory.
 */
function buildRecalledMemory(
  staticMd: string | null,
  sessionEntries: { content: string }[],
  query: string,
): string | null {
  const lines: string[] = [];
  if (staticMd) {
    lines.push(
      ...staticMd
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
  }
  for (const e of sessionEntries) lines.push(`- ${e.content}`);
  if (lines.length === 0) return null;

  const recalled = query.trim()
    ? recallTop(lines, query, { limit: 8, threshold: 0 })
    : lines.slice(0, 8);
  if (recalled.length === 0) return null;
  return `${MEMORY_NOTE}\n${recalled.join("\n")}\n${MEMORY_NOTE_END}`;
}

function injectEnvIntoLastUser(
  messages: UIMessage[],
  envBlock: string,
): UIMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const parts = m.parts as ReadonlyArray<{ type: string; text?: string }>;
    let textIdx = -1;
    for (let j = 0; j < parts.length; j++) {
      if (parts[j].type === "text") {
        textIdx = j;
        break;
      }
    }
    const nextParts =
      textIdx === -1
        ? [{ type: "text", text: envBlock }, ...parts]
        : parts.map((p, idx) =>
            idx === textIdx
              ? { ...p, text: `${envBlock}\n\n${p.text ?? ""}` }
              : p,
          );
    const out = messages.slice();
    out[i] = { ...m, parts: nextParts } as UIMessage;
    return out;
  }
  return messages;
}

function formatEnvBlock(live: LiveSnapshot): string | null {
  const lines: string[] = [];
  if (live.workspaceRoot) lines.push(`workspace_root: ${live.workspaceRoot}`);
  if (live.cwd) lines.push(`active_terminal_cwd: ${live.cwd}`);
  if (live.activeFile) lines.push(`active_file: ${live.activeFile}`);
  if (live.terminalPrivate) lines.push("active_terminal_mode: private");
  if (lines.length === 0) return null;
  return `<env>\n${lines.join("\n")}\n</env>`;
}

export const CONTEXT_BLOCK_RE =
  /^<terminal-context[^>]*>[\s\S]*?<\/terminal-context>\n*/;

export function stripContextBlock(text: string): string {
  return text.replace(CONTEXT_BLOCK_RE, "");
}

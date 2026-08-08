import type { UIMessage } from "@ai-sdk/react";
import { useMemoryStore } from "../store/memoryStore";

let settleCounter = 0;
function settleId(): string {
  return `auto-${Date.now().toString(36)}-${(settleCounter++).toString(36)}`;
}

/**
 * Auto-settle (P1-4, hermes `on_turn_complete`): at the end of a turn that
 * actually did work (tool calls / edits), distill the final assistant summary
 * into a reusable project-memory note tagged `source:"auto"`, WITHOUT the agent
 * having to call update_project_memory explicitly.
 *
 * This module is pure/testable: `pickAutoSettleCandidate` decides WHAT to
 * persist; `settleAutoMemory` writes it through the store.
 */

const MIN_SUMMARY_LEN = 24;
const MAX_SUMMARY_LEN = 300;

/** Extract the final assistant text summary from a message list. */
export function lastAssistantText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const parts = m.parts as ReadonlyArray<{ type: string; text?: string }>;
    for (let j = parts.length - 1; j >= 0; j--) {
      const t = parts[j];
      if (t.type === "text" && t.text) return t.text.trim();
    }
  }
  return "";
}

/** Did this turn actually use tools (i.e. do work worth remembering)? */
export function turnUsedTools(messages: UIMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const parts = m.parts as ReadonlyArray<{ type: string }>;
    for (const p of parts) {
      if (p.type === "tool-call") return true;
    }
  }
  return false;
}

/** Normalize a summary into a single concise auto-settled note, or null. */
export function normalizeAutoSettle(
  summary: string,
  opts: { minLen?: number; maxLen?: number } = {},
): string | null {
  const min = opts.minLen ?? MIN_SUMMARY_LEN;
  const max = opts.maxLen ?? MAX_SUMMARY_LEN;
  const collapsed = summary.replace(/\s+/g, " ").trim();
  if (collapsed.length < min) return null;
  // Skip obvious non-findings (question/acknowledgment/handoff).
  if (/^(ok|done|got it|sure|let me)/i.test(collapsed)) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/**
 * Write an auto-settled note into the in-session memory store (source:"auto"),
 * deduped by near-identical content. Cross-session YAMET.md persistence is
 * skipped for auto-settles to avoid spamming the durable file with every
 * turn's summary.
 */
export function settleAutoMemory(
  sessionId: string | null,
  summary: string,
): string | null {
  const note = normalizeAutoSettle(summary);
  if (!note) return null;
  if (!sessionId) return null;
  const existing = useMemoryStore.getState().bySession[sessionId] ?? [];
  const dup = existing.some(
    (e) => e.content.replace(/\s+/g, " ").toLowerCase() === note.toLowerCase(),
  );
  if (dup) return null;
  useMemoryStore.getState().addMemory(sessionId, {
    id: settleId(),
    content: note,
    createdAt: Date.now(),
    source: "auto",
  });
  return note;
}

/** Convenience: run the whole auto-settle pipeline over a turn's messages. */
export function autoSettleTurn(
  sessionId: string | null,
  messages: UIMessage[],
): string | null {
  if (!turnUsedTools(messages)) return null;
  return settleAutoMemory(sessionId, lastAssistantText(messages));
}

/**
 * Auto-settle from the transport's final-text snapshot (P1-4). The Chat store
 * appends the streamed assistant message after the transport onFinish returns,
 * so the caller passes the run's own final text here rather than re-reading
 * chat.messages (which would be the previous turn). `usedTools` mirrors
 * `turnUsedTools` so we only settle turns that actually did tool work.
 */
export function autoSettleText(
  sessionId: string | null,
  finalText: string,
  usedTools = true,
): string | null {
  if (!usedTools) return null;
  return settleAutoMemory(sessionId, finalText);
}

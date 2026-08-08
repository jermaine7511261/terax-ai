/**
 * Gateway ↔ AI bridge.
 *
 * Handles the full message loop for inbound gateway messages:
 *   message arrives → inject into chat → LLM responds → send reply back
 *
 * Mirrors Hermes' `_handle_message()` → `_run_agent()` → `send_message()`
 * pipeline: receive inbound, run through the agent, route the response
 * back to the originating platform.
 */

import { invoke } from "@/platform";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GatewayMessageMeta = {
  platform: string;
  chatId: string;
  chatType: "dm" | "group";
  senderId: string;
};

// ---------------------------------------------------------------------------
// Pending gateway context — tracks the last inbound message that needs a
// reply routed back to the originating platform.
// ---------------------------------------------------------------------------

let pendingMeta: GatewayMessageMeta | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** How long to wait for an LLM response before giving up (ms). */
const REPLY_TIMEOUT_MS = 120_000;

/**
 * Store gateway metadata for the next LLM response.  Called by the
 * `yamet:ai-ask` dispatch when the message originates from a gateway
 * platform (WeChat, DingTalk, etc.).
 */
export function setPendingGatewayMeta(meta: GatewayMessageMeta): void {
  pendingMeta = meta;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingMeta = null;
    pendingTimer = null;
  }, REPLY_TIMEOUT_MS);
}

/**
 * Consume the pending gateway metadata (if any).  Returns `null` if there is
 * no pending gateway reply to route, or if the timeout expired.
 */
export function consumePendingGatewayMeta(): GatewayMessageMeta | null {
  const m = pendingMeta;
  pendingMeta = null;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Send reply back to the originating platform
// ---------------------------------------------------------------------------

/**
 * Send a text reply back through the gateway.  Called after the LLM has
 * produced a response for an inbound gateway message.
 */
async function sendGatewayReply(
  meta: GatewayMessageMeta,
  text: string,
): Promise<void> {
  if (!text.trim()) return;
  try {
    await invoke("gateway_send", {
      platform: meta.platform,
      chatId: meta.chatId,
      text,
      group: meta.chatType === "group",
    });
  } catch (err) {
    console.error("[gateway-bridge] sendGatewayReply failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Listen for LLM response completion and route back to gateway
// ---------------------------------------------------------------------------

/**
 * Set up the response listener.  When a gateway message is pending and the
 * LLM finishes responding, the last assistant message text is extracted and
 * sent back to the originating platform via `gateway_send`.
 *
 * Must be called once at app startup (e.g. in App.tsx).
 */
export function setupGatewayResponseListener(): () => void {
  // We subscribe to the chat store's message changes.  The AI SDK's Chat
  // object updates messages in the Zustand store, so we watch for a new
  // assistant message appearing after a gateway message was injected.
  //
  // Strategy: use a MutationObserver on the DOM to detect when a new
  // assistant message bubble appears, then extract its text content.
  // This avoids coupling to internal Chat store shape.
  //
  // However, a simpler approach: use the `yamet:gateway-reply` custom
  // event that the composer will fire when it detects the assistant has
  // finished responding to a gateway-injected message.

  const onReply = (e: Event) => {
    const text = (e as CustomEvent<string>).detail;
    const meta = consumePendingGatewayMeta();
    if (meta && typeof text === "string" && text.trim()) {
      void sendGatewayReply(meta, text);
    }
  };

  window.addEventListener("yamet:gateway-reply", onReply);
  return () => window.removeEventListener("yamet:gateway-reply", onReply);
}

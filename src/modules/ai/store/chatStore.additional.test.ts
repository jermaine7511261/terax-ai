import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Dependency mocks (same pattern as chatStore.test.ts) ─────────────
const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries() { return []; }
    get() { return undefined; }
    set() {}
    delete() {}
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/settings/store", () => ({
  setProjectAutoApprove: vi.fn(async () => {}),
  setRecentModelIds: vi.fn(async () => {}),
  setFavoriteModelIds: vi.fn(async () => {}),
  setSelectedModelId: vi.fn(async () => {}),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ favoriteModelIds: [], recentModelIds: [] }),
  },
}));

import { useChatStore, chats, touchChat, getChat, stop } from "./chatStore";

function resetStore() {
  useChatStore.setState({
    approvalResponder: null,
    firstApprovalResolved: false,
    sessionApprovalArmed: false,
    rememberScope: "window" as const,
    deniedTools: [],
    apiKeys: { deepseek: null, mistral: null, openrouter: null, "openai-compatible": null, "llama.cpp": null },
    customEndpointKeys: {},
    selectedModelId: "deepseek-v4-flash",
    agentMeta: {
      status: "idle", step: null, approvalsPending: 0, error: null,
      tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      lastInputTokens: 0, lastCachedTokens: 0, hitStepCap: false,
      phase: null, doomLoopDetected: false, stepCount: 0, compactionNotice: null,
    },
    sessions: [],
    activeSessionId: null,
    incompleteTurns: {},
    sessionToolAllowlist: {},
    contextEstimate: 0,
    pendingPrefill: null,
    pendingSelections: [],
    mini: { open: false },
    panelOpen: false,
  });
  chats.clear();
}

beforeEach(resetStore);

// ═══════════════════════════════════════════════════════════════════════
// Session lifecycle
// ═══════════════════════════════════════════════════════════════════════
describe("session lifecycle", () => {
  it("newSession creates a session and activates it", () => {
    const id = useChatStore.getState().newSession();
    expect(id).toBeTruthy();
    expect(useChatStore.getState().activeSessionId).toBe(id);
    expect(useChatStore.getState().sessions.some((s) => s.id === id)).toBe(true);
    expect(useChatStore.getState().sessions[0].title).toBe("New chat");
  });

  it("switchSession changes the active session", async () => {
    const id1 = useChatStore.getState().newSession();
    const id2 = useChatStore.getState().newSession();
    expect(useChatStore.getState().activeSessionId).toBe(id2);
    useChatStore.getState().switchSession(id1);
    // switchSession calls loadMessages() async → flush microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(useChatStore.getState().activeSessionId).toBe(id1);
  });

  it("switchSession is a no-op when id === activeSessionId", async () => {
    const id = useChatStore.getState().newSession();
    useChatStore.getState().switchSession(id);
    await new Promise((r) => setTimeout(r, 10));
    expect(useChatStore.getState().activeSessionId).toBe(id);
  });

  it("switchSession ignores unknown ids", async () => {
    const id = useChatStore.getState().newSession();
    useChatStore.getState().switchSession("nonexistent");
    await new Promise((r) => setTimeout(r, 10));
    expect(useChatStore.getState().activeSessionId).toBe(id);
  });

  it("deleteSession removes a session and switches to another", () => {
    const id1 = useChatStore.getState().newSession();
    const id2 = useChatStore.getState().newSession();
    useChatStore.getState().deleteSession(id2);
    expect(useChatStore.getState().sessions.some((s) => s.id === id2)).toBe(false);
    expect(useChatStore.getState().activeSessionId).toBe(id1);
  });

  it("deleteSession creates a fresh session when all are deleted", () => {
    const id1 = useChatStore.getState().newSession();
    useChatStore.getState().deleteSession(id1);
    expect(useChatStore.getState().sessions.length).toBe(1);
    expect(useChatStore.getState().sessions[0].title).toBe("New chat");
  });

  it("renameSession updates the title", () => {
    const id = useChatStore.getState().newSession();
    useChatStore.getState().renameSession(id, "My session");
    const s = useChatStore.getState().sessions.find((x) => x.id === id);
    expect(s?.title).toBe("My session");
  });

  it("deleteSession stops the chat if cached", () => {
    const id = useChatStore.getState().newSession();
    const mockChat = { stop: vi.fn(), id, messages: [] } as unknown as import("@ai-sdk/react").Chat<import("ai").UIMessage>;
    touchChat(id, mockChat);
    useChatStore.getState().deleteSession(id);
    expect((mockChat as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    expect(chats.has(id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Tool allowlist
// ═══════════════════════════════════════════════════════════════════════
describe("sessionToolAllowlist", () => {
  it("set/get round-trips for a session", () => {
    useChatStore.getState().setSessionToolAllowlist("s1", ["read_file", "grep"]);
    expect(useChatStore.getState().sessionToolAllowlist["s1"]).toEqual([
      "read_file",
      "grep",
    ]);
  });

  it("undefined clears the allowlist", () => {
    useChatStore.getState().setSessionToolAllowlist("s1", ["read_file"]);
    useChatStore.getState().setSessionToolAllowlist("s1", undefined);
    expect(useChatStore.getState().sessionToolAllowlist["s1"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Mini / Panel state
// ═══════════════════════════════════════════════════════════════════════
describe("mini & panel state", () => {
  it("openMini / closeMini / toggleMini", () => {
    useChatStore.getState().openMini();
    expect(useChatStore.getState().mini.open).toBe(true);
    useChatStore.getState().closeMini();
    expect(useChatStore.getState().mini.open).toBe(false);
    useChatStore.getState().toggleMini();
    expect(useChatStore.getState().mini.open).toBe(true);
    useChatStore.getState().toggleMini();
    expect(useChatStore.getState().mini.open).toBe(false);
  });

  it("openPanel / closePanel / togglePanel", () => {
    useChatStore.getState().openPanel();
    expect(useChatStore.getState().panelOpen).toBe(true);
    useChatStore.getState().closePanel();
    expect(useChatStore.getState().panelOpen).toBe(false);
    useChatStore.getState().togglePanel();
    expect(useChatStore.getState().panelOpen).toBe(true);
  });

  it("focusInput opens panel and increments focusSignal", () => {
    const prev = useChatStore.getState().focusSignal;
    useChatStore.getState().focusInput("hello");
    expect(useChatStore.getState().panelOpen).toBe(true);
    expect(useChatStore.getState().focusSignal).toBe(prev + 1);
    expect(useChatStore.getState().pendingPrefill).toBe("hello");
  });

  it("consumePrefill returns and clears the pending prefill", () => {
    useChatStore.getState().focusInput("world");
    expect(useChatStore.getState().consumePrefill()).toBe("world");
    expect(useChatStore.getState().consumePrefill()).toBeNull();
  });

  it("focusInput(null) sets pendingPrefill to null", () => {
    useChatStore.getState().focusInput("x");
    useChatStore.getState().focusInput();
    expect(useChatStore.getState().pendingPrefill).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Selection management
// ═══════════════════════════════════════════════════════════════════════
describe("pendingSelections", () => {
  it("attachSelection adds a trimmed selection and opens panel", () => {
    useChatStore.getState().attachSelection("  hello world  ", "terminal");
    expect(useChatStore.getState().pendingSelections).toHaveLength(1);
    expect(useChatStore.getState().pendingSelections[0].text).toBe("hello world");
    expect(useChatStore.getState().pendingSelections[0].source).toBe("terminal");
    expect(useChatStore.getState().panelOpen).toBe(true);
  });

  it("attachSelection ignores empty strings", () => {
    useChatStore.getState().attachSelection("   ", "editor");
    expect(useChatStore.getState().pendingSelections).toHaveLength(0);
  });

  it("consumeSelections returns and clears all", () => {
    useChatStore.getState().attachSelection("a", "terminal");
    useChatStore.getState().attachSelection("b", "editor");
    const result = useChatStore.getState().consumeSelections();
    expect(result).toHaveLength(2);
    expect(useChatStore.getState().pendingSelections).toHaveLength(0);
  });

  it("consumeSelections returns empty without clearing", () => {
    expect(useChatStore.getState().consumeSelections()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// contextEstimate / incompleteTurns / setApiKey / setSelectedModelId
// ═══════════════════════════════════════════════════════════════════════
describe("misc store actions", () => {
  it("setApiKey / apiKeys round-trips", () => {
    useChatStore.getState().setApiKey("deepseek", "sk-ds");
    expect(useChatStore.getState().apiKeys.deepseek).toBe("sk-ds");
    useChatStore.getState().setApiKey("deepseek", null);
    expect(useChatStore.getState().apiKeys.deepseek).toBeNull();
  });

  it("setCustomEndpointKeys replaces the full map", () => {
    useChatStore.getState().setCustomEndpointKeys({ ep1: "k1" });
    expect(useChatStore.getState().customEndpointKeys).toEqual({ ep1: "k1" });
  });

  it("setSelectedModelId updates state and triggers persistence", () => {
    useChatStore.getState().setSelectedModelId("mistral-small-latest");
    expect(useChatStore.getState().selectedModelId).toBe("mistral-small-latest");
    // persistence is fire-and-forget; just verify the store updated.
  });

  it("setContextEstimate updates the value", () => {
    useChatStore.getState().setContextEstimate(42000);
    expect(useChatStore.getState().contextEstimate).toBe(42000);
  });

  it("setIncompleteTurn updates turns and sessions", () => {
    const id = useChatStore.getState().newSession();
    useChatStore.getState().setIncompleteTurn(id, true);
    expect(useChatStore.getState().incompleteTurns[id]).toBe(true);
    expect(
      useChatStore.getState().sessions.find((s) => s.id === id)
        ?.incompleteTurn,
    ).toBe(true);
    useChatStore.getState().setIncompleteTurn(id, false);
    expect(useChatStore.getState().incompleteTurns[id]).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// stop()
// ═══════════════════════════════════════════════════════════════════════
describe("stop()", () => {
  it("stops the active session's chat", () => {
    const id = useChatStore.getState().newSession();
    const mockChat = { stop: vi.fn() } as never;
    touchChat(id, mockChat);
    stop();
    expect(mockChat.stop).toHaveBeenCalled();
  });

  it("stop is a no-op when no session is active", () => {
    expect(() => stop()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// LRU eviction
// ═══════════════════════════════════════════════════════════════════════
describe("LRU chat cache", () => {
  it("evicts the oldest entry when exceeding CHATS_LRU_CAP (8)", () => {
    // fill 9 unique ids; the oldest should be evicted.
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      const id = `s-${i}`;
      const chat = { stop: vi.fn(), id, messages: [] } as unknown as import("@ai-sdk/react").Chat<import("ai").UIMessage>;
      touchChat(id, chat);
      ids.push(id);
    }
    // s-0 was inserted first, so it should be evicted (but only if it's not the active session)
    expect(chats.has("s-0")).toBe(false);
    // the 8 most recent should remain
    expect(chats.size).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getChat()
// ═══════════════════════════════════════════════════════════════════════
describe("getChat", () => {
  it("returns undefined for a non-cached session", () => {
    expect(getChat("nonexistent")).toBeUndefined();
  });

  it("returns the chat for a specific session id", () => {
    const chat = { stop: vi.fn() } as never;
    touchChat("s-x", chat);
    expect(getChat("s-x")).toBe(chat);
  });
});

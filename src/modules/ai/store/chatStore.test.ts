import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Dependency mocks ──────────────────────────────────────────────────────
// chatStore transitively imports the Tauri store plugin (via ../lib/sessions
// and ./todoStore → ../lib/todos) and the settings modules. We shim them so
// the module graph loads under plain node and so approval/agent logic can be
// asserted against controlled fakes.

const {
  setProjectAutoApprove,
  setRecentModelIds,
  setFavoriteModelIds,
  setSelectedModelId,
} = vi.hoisted(() => ({
  setProjectAutoApprove: vi.fn(async () => {}),
  setRecentModelIds: vi.fn(async () => {}),
  setFavoriteModelIds: vi.fn(async () => {}),
  setSelectedModelId: vi.fn(async () => {}),
}));

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async () => null),
}));

const { usePreferencesStore } = vi.hoisted(() => ({
  usePreferencesStore: {
    getState: () => ({ favoriteModelIds: [], recentModelIds: [] }),
  },
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries() {
      return [];
    }
    get() {
      return undefined;
    }
    set() {}
    delete() {}
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("@/modules/settings/store", () => ({
  setProjectAutoApprove,
  setRecentModelIds,
  setFavoriteModelIds,
  setSelectedModelId,
}));

vi.mock("@/modules/settings/preferences", () => ({ usePreferencesStore }));

// ─── Module under test ─────────────────────────────────────────────────────
import {
  useChatStore,
  handleApprovalDecision,
  hasKeyForModel,
  getActiveProviderKey,
  getAgentMeta,
  touchChat,
  getChat,
  chats,
} from "./chatStore";

import type { AgentMeta } from "./chatStore";

const IDLE_META: AgentMeta = {
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  phase: null,
  doomLoopDetected: false,
  stepCount: 0,
  compactionNotice: null,
};

const NO_KEYS = {
  deepseek: null,
  mistral: null,
  openrouter: null,
  "openai-compatible": null,
  "llama.cpp": null,
};

function resetStore() {
  useChatStore.setState({
    approvalResponder: null,
    firstApprovalResolved: false,
    sessionApprovalArmed: false,
    rememberScope: "window",
    deniedTools: [],
    apiKeys: { ...NO_KEYS },
    customEndpointKeys: {},
    selectedModelId: "deepseek-v4-flash",
    agentMeta: { ...IDLE_META },
    sessions: [],
    activeSessionId: null,
  });
  chats.clear();
  setProjectAutoApprove.mockClear();
  invoke.mockClear();
}

beforeEach(() => {
  resetStore();
});

// ═══════════════════════════════════════════════════════════════════════
// handleApprovalDecision
// ═══════════════════════════════════════════════════════════════════════
describe("handleApprovalDecision", () => {
  it("approves, arms window-scope auto-approve, and responds", () => {
    const respond = vi.fn();
    handleApprovalDecision("a1", true, undefined, respond);
    expect(useChatStore.getState().firstApprovalResolved).toBe(true);
    expect(useChatStore.getState().sessionApprovalArmed).toBe(false);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({ id: "a1", approved: true });
  });

  it("approve with rememberScope 'session' arms session scope", () => {
    const respond = vi.fn();
    handleApprovalDecision("a1", true, { rememberScope: "session" }, respond);
    expect(useChatStore.getState().sessionApprovalArmed).toBe(true);
    expect(useChatStore.getState().firstApprovalResolved).toBe(false);
  });

  it("approve with rememberScope 'project' persists the preference", () => {
    const respond = vi.fn();
    handleApprovalDecision("a1", true, { rememberScope: "project" }, respond);
    expect(setProjectAutoApprove).toHaveBeenCalledWith(true);
    expect(useChatStore.getState().firstApprovalResolved).toBe(false);
    expect(useChatStore.getState().sessionApprovalArmed).toBe(false);
  });

  it("approve without a scope uses the store's current rememberScope", () => {
    useChatStore.getState().setRememberScope("session");
    const respond = vi.fn();
    handleApprovalDecision("a1", true, undefined, respond);
    expect(useChatStore.getState().sessionApprovalArmed).toBe(true);
  });

  it("a deny never arms auto-approve (even with rememberDeniedTool)", () => {
    useChatStore.setState({
      firstApprovalResolved: true,
      sessionApprovalArmed: true,
    });
    const respond = vi.fn();
    handleApprovalDecision(
      "a1",
      false,
      { rememberDeniedTool: true, toolName: "bash" },
      respond,
    );
    expect(useChatStore.getState().deniedTools).toEqual(["bash"]);
    // State must NOT have been reset/armed by the deny — it stays as-is.
    expect(useChatStore.getState().firstApprovalResolved).toBe(true);
    expect(useChatStore.getState().sessionApprovalArmed).toBe(true);
    expect(respond).toHaveBeenCalledWith({ id: "a1", approved: false });
  });

  it("a deny without rememberDeniedTool does not blacklist or arm", () => {
    const respond = vi.fn();
    handleApprovalDecision("a1", false, undefined, respond);
    expect(useChatStore.getState().deniedTools).toEqual([]);
    expect(useChatStore.getState().firstApprovalResolved).toBe(false);
    expect(respond).toHaveBeenCalledWith({ id: "a1", approved: false });
  });

  it("respond is always called exactly once", () => {
    const respond = vi.fn();
    handleApprovalDecision("x", true, { rememberScope: "session" }, respond);
    expect(respond).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Store approval-state logic
// ═══════════════════════════════════════════════════════════════════════
describe("store approval logic", () => {
  it("markFirstApprovalResolved with default scope sets firstApprovalResolved", () => {
    useChatStore.getState().markFirstApprovalResolved();
    expect(useChatStore.getState().firstApprovalResolved).toBe(true);
  });

  it("markFirstApprovalResolved('session') arms session scope only", () => {
    useChatStore.getState().markFirstApprovalResolved("session");
    expect(useChatStore.getState().sessionApprovalArmed).toBe(true);
    expect(useChatStore.getState().firstApprovalResolved).toBe(false);
  });

  it("markFirstApprovalResolved('project') persists auto-approve", () => {
    useChatStore.getState().markFirstApprovalResolved("project");
    expect(setProjectAutoApprove).toHaveBeenCalledWith(true);
  });

  it("setRememberScope updates the current scope", () => {
    useChatStore.getState().setRememberScope("project");
    expect(useChatStore.getState().rememberScope).toBe("project");
  });

  it("addDeniedTool appends and dedupes tool names", () => {
    const st = useChatStore.getState();
    st.addDeniedTool("bash");
    st.addDeniedTool("bash");
    st.addDeniedTool("file_edit");
    expect(useChatStore.getState().deniedTools).toEqual(["bash", "file_edit"]);
  });

  it("respondToApproval forwards to the registered responder", () => {
    const responder = vi.fn();
    useChatStore.getState().setApprovalResponder(responder);
    useChatStore.getState().respondToApproval("a1", true);
    expect(responder).toHaveBeenCalledWith("a1", true);
  });

  it("respondToApproval is a no-op with no responder registered", () => {
    expect(() =>
      useChatStore.getState().respondToApproval("a1", true),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Agent-meta logic
// ═══════════════════════════════════════════════════════════════════════
describe("agent meta", () => {
  it("getAgentMeta returns the idle default initially", () => {
    expect(getAgentMeta()).toMatchObject({
      status: "idle",
      approvalsPending: 0,
      error: null,
    });
  });

  it("patchAgentMeta merges a partial patch", () => {
    useChatStore
      .getState()
      .patchAgentMeta({ status: "thinking", step: "researching" });
    const meta = getAgentMeta();
    expect(meta.status).toBe("thinking");
    expect(meta.step).toBe("researching");
    // untouched fields preserved
    expect(meta.approvalsPending).toBe(0);
  });

  it("resetAgentMeta restores the idle default", () => {
    useChatStore.getState().patchAgentMeta({ status: "error", error: "boom" });
    useChatStore.getState().resetAgentMeta();
    expect(getAgentMeta()).toMatchObject({
      status: "idle",
      step: null,
      approvalsPending: 0,
      error: null,
    });
  });

  it("newSession resets agent meta and session approval", () => {
    useChatStore.getState().patchAgentMeta({ status: "streaming" });
    useChatStore.getState().markFirstApprovalResolved("session");
    useChatStore.getState().newSession();
    expect(getAgentMeta().status).toBe("idle");
    expect(useChatStore.getState().sessionApprovalArmed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// hasKeyForModel
// ═══════════════════════════════════════════════════════════════════════
describe("hasKeyForModel", () => {
  it("returns true for a compat model regardless of keys", () => {
    expect(hasKeyForModel("compat-opencode-go")).toBe(true);
  });

  it("returns true for a key-requiring model when its key is set", () => {
    useChatStore.getState().setApiKey("deepseek", "sk-test");
    expect(hasKeyForModel("deepseek-v4-flash")).toBe(true);
  });

  it("returns false for a key-requiring model when its key is missing", () => {
    expect(hasKeyForModel("deepseek-v4-flash")).toBe(false);
  });

  it("returns true for a keyless local model without a key", () => {
    expect(hasKeyForModel("llama-cpp-local")).toBe(true);
  });

  it("returns true for a key-optional openai-compatible model without a key", () => {
    expect(hasKeyForModel("openai-compatible-custom")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// getActiveProviderKey
// ═══════════════════════════════════════════════════════════════════════
describe("getActiveProviderKey", () => {
  it("returns the key for the selected model's provider", () => {
    useChatStore.getState().setApiKey("deepseek", "sk-ds");
    useChatStore.getState().setSelectedModelId("deepseek-v4-flash");
    expect(getActiveProviderKey()).toBe("sk-ds");
  });

  it("returns null when the selected provider has no key", () => {
    useChatStore.getState().setSelectedModelId("deepseek-v4-flash");
    expect(getActiveProviderKey()).toBeNull();
  });

  it("returns the custom endpoint key for a compat model", () => {
    useChatStore.setState({
      selectedModelId: "compat-opencode-go",
      customEndpointKeys: { "opencode-go": "sk-compat" },
    });
    expect(getActiveProviderKey()).toBe("sk-compat");
  });

  it("returns null for a compat model with no custom endpoint key", () => {
    useChatStore.setState({ selectedModelId: "compat-opencode-go" });
    expect(getActiveProviderKey()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// touchChat / getChat (LRU chat cache)
// ═══════════════════════════════════════════════════════════════════════
describe("chat cache", () => {
  it("touchChat stores and getChat retrieves by id", () => {
    const chat = { stop: vi.fn() } as never;
    touchChat("s-1", chat);
    expect(getChat("s-1")).toBe(chat);
    expect(getChat()).toBeUndefined(); // no active session
  });

  it("getChat() falls back to the active session's chat", () => {
    const chat = { stop: vi.fn() } as never;
    touchChat("s-2", chat);
    useChatStore.setState({ activeSessionId: "s-2" });
    expect(getChat()).toBe(chat);
  });

  it("touchChat re-inserts an id at the end (recency order)", () => {
    const c1 = { stop: vi.fn() } as never;
    const c2 = { stop: vi.fn() } as never;
    touchChat("s-1", c1);
    touchChat("s-2", c2);
    touchChat("s-1", c1);
    expect(Array.from(chats.keys())).toEqual(["s-2", "s-1"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// P2-2: sub-session parentID tree (H2)
// ═══════════════════════════════════════════════════════════════════════
describe("sub-session parentID tree", () => {
  it("createSubSession creates a child with parentId and independent id", () => {
    const parentId = useChatStore.getState().newSession();
    const childId = useChatStore.getState().createSubSession(parentId);
    const child = useChatStore
      .getState()
      .sessions.find((s) => s.id === childId);
    expect(child).toBeDefined();
    expect(child?.parentId).toBe(parentId);
    expect(child?.title).toBe("Sub task");
    expect(useChatStore.getState().activeSessionId).toBe(childId);
  });

  it("resolveRootSessionId walks the chain to the top root", () => {
    const root = useChatStore.getState().newSession();
    const child = useChatStore.getState().createSubSession(root);
    const grandchild = useChatStore.getState().createSubSession(child);
    expect(useChatStore.getState().resolveRootSessionId(grandchild)).toBe(root);
    expect(useChatStore.getState().resolveRootSessionId(root)).toBe(root);
  });

  it("resolveRootSessionId is cycle-safe (guards against corrupt parent chains)", () => {
    const st = useChatStore.getState();
    const a = st.newSession();
    const b = st.createSubSession(a);
    // Corrupt: point a's parent back at b → cycle a<->b.
    useChatStore.setState({
      sessions: useChatStore
        .getState()
        .sessions.map((s) => (s.id === a ? { ...s, parentId: b } : s)),
    });
    // Must terminate (return the starting node rather than infinite-loop).
    expect(useChatStore.getState().resolveRootSessionId(a)).toBe(a);
  });

  it("deleting a sub-session removes it from the tree", () => {
    const root = useChatStore.getState().newSession();
    const child = useChatStore.getState().createSubSession(root);
    expect(
      useChatStore.getState().sessions.some((s) => s.id === child),
    ).toBe(true);
    useChatStore.getState().deleteSession(child);
    expect(
      useChatStore.getState().sessions.some((s) => s.id === child),
    ).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// chatRuntime wires the AI SDK Chat runtime together from many live modules
// (transport, config, chatStore, preferences, agents). We mock the heavy
// dependencies and exercise only the pure guard logic of sendMessage():
// short-circuiting on missing session id / missing provider key.

const { chatMock } = vi.hoisted(() => {
  // Mutable snapshot of useChatStore state that the test can rewrite.
  const chatState: { activeSessionId: string | null; selectedModelId: string } =
    { activeSessionId: null, selectedModelId: "deepseek-chat" };
  return {
    chatMock: {
      chatState,
      useChatStore: {
        getState: () => chatState,
      },
      getActiveProviderKey: vi.fn(() => null) as ReturnType<
        typeof vi.fn<() => string | null>
      >,
      chats: new Map(),
      seedMessages: new Map(),
      touchChat: vi.fn(),
    },
  };
});

vi.mock("@ai-sdk/react", () => {
  class MockChat {
    id: string;
    constructor(init: { id: string }) {
      this.id = init.id;
    }
    sendMessage = vi.fn(() => Promise.resolve());
    messages: unknown[] = [];
  }
  return { Chat: MockChat };
});
vi.mock("ai", () => ({
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(() => false),
}));
vi.mock("../config", () => ({
  getModel: vi.fn((id: string) => ({ provider: id })),
  providerNeedsKey: vi.fn(() => false),
}));
vi.mock("../lib/transport", () => ({
  createContextAwareTransport: vi.fn(),
}));
vi.mock("./chatStore", () => chatMock);
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({}) },
}));
vi.mock("../lib/agents", () => ({
  BUILTIN_AGENTS: [],
}));
vi.mock("./agentsStore", () => ({
  useAgentsStore: { getState: () => ({ activeId: "x", customAgents: [] }) },
}));
vi.mock("./planStore", () => ({
  usePlanStore: { getState: () => ({ active: false }) },
}));

import { getModel, providerNeedsKey } from "../config";
import { sendMessage } from "./chatRuntime";

const mockedGetModel = getModel as ReturnType<typeof vi.fn>;
const mockedProviderNeedsKey = providerNeedsKey as ReturnType<typeof vi.fn>;
const mockedGetActiveProviderKey = chatMock.getActiveProviderKey;

beforeEach(() => {
  chatMock.chatState.activeSessionId = null;
  chatMock.chatState.selectedModelId = "deepseek-chat";
  mockedGetActiveProviderKey.mockReset();
  mockedProviderNeedsKey.mockReset();
  mockedGetModel.mockReset();
  mockedGetModel.mockImplementation((id: string) => ({ provider: id }));
  mockedProviderNeedsKey.mockReturnValue(false);
});

describe("sendMessage guard logic", () => {
  it("returns false when there is no active session", async () => {
    chatMock.chatState.activeSessionId = null;
    await expect(sendMessage("hi")).resolves.toBe(false);
  });

  it("returns false when the provider needs a key but none is set", async () => {
    chatMock.chatState.activeSessionId = "sess-1";
    mockedGetModel.mockReturnValue({ provider: "openai" });
    mockedProviderNeedsKey.mockReturnValue(true);
    mockedGetActiveProviderKey.mockReturnValue(null);

    await expect(sendMessage("hi")).resolves.toBe(false);

    expect(mockedGetModel).toHaveBeenCalledWith("deepseek-chat");
    expect(mockedGetActiveProviderKey).toHaveBeenCalled();
  });

  it("returns true and sends when a key is present", async () => {
    chatMock.chatState.activeSessionId = "sess-1";
    mockedProviderNeedsKey.mockReturnValue(true);
    mockedGetActiveProviderKey.mockReturnValue("sk-abc");

    const ok = await sendMessage("hi");
    expect(ok).toBe(true);
    expect(mockedGetActiveProviderKey).toHaveBeenCalled();
  });
});

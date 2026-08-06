// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chatState = vi.hoisted(() => {
  return {
    apiKeys: {},
    setApiKeys: vi.fn(),
    setCustomEndpointKeys: vi.fn(),
    setSelectedModelId: vi.fn(),
    activeSessionId: null as string | null,
    hydrateSessions: vi.fn(async () => undefined),
    live: { getWorkspaceRoot: vi.fn(() => null), spawnManagedAgent: vi.fn() },
  };
});

const prefsState = vi.hoisted(() => {
  return {
    llamaCppModelId: "",
    llamaCppBaseURL: "",
    openaiCompatibleModelId: "",
    openaiCompatibleBaseURL: "",
    customEndpoints: [] as { id: string; name: string; baseURL: string; modelId: string; contextLimit: number }[],
    hydrated: false,
    defaultModelId: "deepseek-v4-flash",
    init: vi.fn(async () => undefined),
  };
});

const keyringMock = vi.hoisted(() => ({
  getAllKeys: vi.fn(async () => ({})),
  getAllCustomEndpointKeys: vi.fn(async () => ({})),
  hasAnyKey: vi.fn(() => false),
}));

const agentsStore = vi.hoisted(() => {
  const state = { hydrate: vi.fn(async () => undefined) };
  return { getState: vi.fn(() => state) };
});
const snippetsStore = vi.hoisted(() => {
  const state = {
    hydrate: vi.fn(async () => undefined),
    mergeBuiltin: vi.fn(),
  };
  return { getState: vi.fn(() => state) };
});
const skillsMock = vi.hoisted(() => ({ scanSkillsDir: vi.fn(async () => []) }));
const reviewMock = vi.hoisted(() => ({
  firePendingReviewForSession: vi.fn(),
}));
const listenMock = vi.hoisted(() =>
  vi.fn(async () => vi.fn() as unknown as () => void),
);
const notificationMock = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted" as const),
  sendNotification: vi.fn(),
}));
const settingsStoreMock = vi.hoisted(() => ({
  onKeysChanged: vi.fn(async () => vi.fn() as unknown as () => void),
}));

vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel(chatState),
    { getState: () => chatState },
  ),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel(prefsState),
    { getState: () => prefsState },
  ),
}));
vi.mock("@/modules/ai/lib/keyring", () => keyringMock);
vi.mock("@/modules/ai/store/agentsStore", () => ({
  useAgentsStore: { getState: agentsStore.getState },
}));
vi.mock("@/modules/ai/store/snippetsStore", () => ({
  useSnippetsStore: { getState: snippetsStore.getState },
}));
vi.mock("@/modules/ai/lib/skills", () => skillsMock);
vi.mock("@/modules/agents/lib/review", () => reviewMock);
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-notification", () => notificationMock);
vi.mock("@/modules/settings/store", () => settingsStoreMock);

import { useAiBootstrap } from "./useAiBootstrap";

beforeEach(() => {
  vi.clearAllMocks();
  chatState.apiKeys = {};
  chatState.activeSessionId = null;
  chatState.setApiKeys.mockClear();
  chatState.setSelectedModelId.mockClear();
  chatState.hydrateSessions.mockClear();
  chatState.live.getWorkspaceRoot.mockReturnValue(null);
  prefsState.llamaCppModelId = "";
  prefsState.llamaCppBaseURL = "";
  prefsState.openaiCompatibleModelId = "";
  prefsState.openaiCompatibleBaseURL = "";
  prefsState.customEndpoints = [];
  prefsState.hydrated = false;
  prefsState.defaultModelId = "deepseek-v4-flash";
  prefsState.init.mockClear();
  keyringMock.getAllKeys.mockResolvedValue({});
  keyringMock.getAllCustomEndpointKeys.mockResolvedValue({});
  keyringMock.hasAnyKey.mockReturnValue(false);
  skillsMock.scanSkillsDir.mockResolvedValue([]);
});

describe("useAiBootstrap", () => {
  it("hydrates stores and loads keys on mount", async () => {
    keyringMock.getAllKeys.mockResolvedValue({ deepseek: "sk-x" });
    const { result } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(chatState.setApiKeys).toHaveBeenCalled());
    expect(keyringMock.getAllKeys).toHaveBeenCalled();
    expect(chatState.setApiKeys).toHaveBeenCalledWith({ deepseek: "sk-x" });
    expect(prefsState.init).toHaveBeenCalled();
    expect(chatState.hydrateSessions).toHaveBeenCalled();
    expect(agentsStore.getState().hydrate).toHaveBeenCalled();
    expect(snippetsStore.getState().hydrate).toHaveBeenCalled();
    expect(result.current.keysLoaded).toBe(true);
  });

  it("computes hasComposer true when a key exists", async () => {
    keyringMock.getAllKeys.mockResolvedValue({ deepseek: "sk-x" });
    chatState.apiKeys = { deepseek: "sk-x" };
    keyringMock.hasAnyKey.mockReturnValue(true);
    const { result } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(result.current.keysLoaded).toBe(true));
    expect(result.current.hasComposer).toBe(true);
  });

  it("computes hasComposer true from a local llama.cpp model", async () => {
    prefsState.llamaCppBaseURL = "http://localhost:8080";
    prefsState.llamaCppModelId = "qwen2.5-coder";
    const { result } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(result.current.keysLoaded).toBe(true));
    expect(result.current.hasComposer).toBe(true);
  });

  it("computes hasComposer true from a local openai-compatible model", async () => {
    prefsState.openaiCompatibleBaseURL = "http://localhost:11434/v1";
    prefsState.openaiCompatibleModelId = "llama3";
    const { result } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(result.current.keysLoaded).toBe(true));
    expect(result.current.hasComposer).toBe(true);
  });

  it("computes hasComposer true from a configured custom endpoint", async () => {
    prefsState.customEndpoints = [
      {
        id: "ep1",
        name: "EP",
        baseURL: "http://localhost:9000",
        modelId: "model-x",
        contextLimit: 128000,
      },
    ];
    const { result } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(result.current.keysLoaded).toBe(true));
    expect(result.current.hasComposer).toBe(true);
  });

  it("computes hasComposer false with no keys and no local model", async () => {
    const { result } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(result.current.keysLoaded).toBe(true));
    expect(result.current.hasComposer).toBe(false);
  });

  it("mirrors the default model into chatStore once prefs are hydrated", async () => {
    const { rerender } = renderHook(() => useAiBootstrap());
    await waitFor(() => expect(keyringMock.getAllKeys).toHaveBeenCalled());
    // Flip hydrated flag and re-render to trigger the mirror effect.
    prefsState.hydrated = true;
    rerender();
    await waitFor(() =>
      expect(chatState.setSelectedModelId).toHaveBeenCalledWith("deepseek-v4-flash"),
    );
  });
});

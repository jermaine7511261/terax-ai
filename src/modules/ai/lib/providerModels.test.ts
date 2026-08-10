// biome-ignore-all lint/style/noNonNullAssertion: 测试断言数据必然存在
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  createProviderProfileRegistry,
  DEFAULT_PROVIDER_REGISTRY,
  fetchModelsForProfile,
  fetchProviderModels,
  providerApiBase,
  refreshProviderModels,
  registerProviderProfile,
  resolveProviderProfile,
  useFetchedModelsStore,
  type ProviderProfile,
} from "./providerModels";

const mockInvoke = vi.mocked(invoke);

const textBody = (s: string): number[] =>
  Array.from(new TextEncoder().encode(s));

function resetStore() {
  useFetchedModelsStore.setState({ cache: {}, loading: {}, error: {} });
}

beforeEach(() => {
  mockInvoke.mockReset();
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("providerApiBase", () => {
  it("returns the raw base URL for local/compatible providers, trailing slash stripped", () => {
    expect(providerApiBase("llama.cpp", "http://localhost:8080/v1/")).toBe(
      "http://localhost:8080/v1",
    );
    expect(providerApiBase("openai-compatible", "https://example.com/v1")).toBe(
      "https://example.com/v1",
    );
  });

  it("maps known providers to their canonical API base", () => {
    expect(providerApiBase("deepseek", "ignored")).toBe(
      "https://api.deepseek.com",
    );
    expect(providerApiBase("mistral", "ignored")).toBe(
      "https://api.mistral.ai/v1",
    );
  });

  it("falls back to the base URL for unknown providers", () => {
    expect(
      providerApiBase("anthropic" as never, "https://custom/v1/"),
    ).toBe("https://custom/v1");
  });
});

describe("fetchProviderModels", () => {
  it("parses a successful /models response", async () => {
    const payload = JSON.stringify({
      data: [
        { id: "a", context_length: 100, owned_by: "me" },
        { id: "b", contextLength: 200 },
        { id: "c" },
        { id: 42 },
      ],
    });
    mockInvoke.mockResolvedValue({
      status: 200,
      headers: {},
      body: textBody(payload),
    });

    const models = await fetchProviderModels("openai-compatible", "http://x/", null);
    expect(models).toEqual([
      { id: "a", contextLength: 100, ownedBy: "me" },
      { id: "b", contextLength: 200, ownedBy: undefined },
      { id: "c", contextLength: undefined, ownedBy: undefined },
    ]);
    expect(mockInvoke).toHaveBeenCalledWith("ai_http_request", {
      url: "http://x/models",
      method: "GET",
      headers: {},
      allowPrivateNetwork: true,
    });
  });

  it("sends an Authorization header when an api key is present", async () => {
    mockInvoke.mockResolvedValue({
      status: 200,
      headers: {},
      body: textBody(JSON.stringify({ data: [{ id: "m" }] })),
    });
    await fetchProviderModels("openai-compatible", "http://x", "secret");
    const [, arg] = mockInvoke.mock.calls[0]!;
    expect((arg as { headers?: Record<string, string> }).headers).toEqual({
      Authorization: "Bearer secret",
    });
  });

  it("throws on a non-2xx status", async () => {
    mockInvoke.mockResolvedValue({ status: 500, headers: {}, body: [] });
    await expect(
      fetchProviderModels("openai-compatible", "http://x", null),
    ).rejects.toThrow("HTTP 500");
  });

  it("propagates invoke rejections", async () => {
    mockInvoke.mockRejectedValue(new Error("network down"));
    await expect(
      fetchProviderModels("openai-compatible", "http://x", null),
    ).rejects.toThrow("network down");
  });

  it("returns an empty list for a missing/malformed data array", async () => {
    mockInvoke.mockResolvedValue({
      status: 200,
      headers: {},
      body: textBody(JSON.stringify({ data: "nope" })),
    });
    const models = await fetchProviderModels("openai-compatible", "http://x", null);
    expect(models).toEqual([]);
  });
});

describe("useFetchedModelsStore + refreshProviderModels", () => {
  it("stores models on success and flags loading transitions", async () => {
    mockInvoke.mockResolvedValue({
      status: 200,
      headers: {},
      body: textBody(JSON.stringify({ data: [{ id: "m1" }] })),
    });

    const promise = refreshProviderModels("openai-compatible", "http://x", null);
    expect(useFetchedModelsStore.getState().loading["openai-compatible::http://x"]).toBe(true);

    const models = await promise;
    expect(models).toEqual([{ id: "m1", contextLength: undefined, ownedBy: undefined }]);
    const s = useFetchedModelsStore.getState();
    expect(s.cache["openai-compatible::http://x"]).toEqual(models);
    expect(s.loading["openai-compatible::http://x"]).toBe(false);
    expect(s.error["openai-compatible::http://x"]).toBeNull();
  });

  it("records the error and falls back to the cached list on failure", async () => {
    mockInvoke.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: textBody(JSON.stringify({ data: [{ id: "m1" }] })),
    });
    await refreshProviderModels("openai-compatible", "http://x", null);

    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    const models = await refreshProviderModels("openai-compatible", "http://x", null);

    expect(models).toEqual([{ id: "m1", contextLength: undefined, ownedBy: undefined }]);
    expect(useFetchedModelsStore.getState().error["openai-compatible::http://x"]).toBe("boom");
  });

  it("returns an empty list when the cache is empty and fetch fails", async () => {
    mockInvoke.mockRejectedValue(new Error("down"));
    const models = await refreshProviderModels("deepseek", "http://x", null);
    expect(models).toEqual([]);
  });
});

describe("ProviderProfile registry", () => {
  const base = (over: Partial<ProviderProfile>): ProviderProfile => ({
    id: "p",
    name: "p",
    ...over,
  });

  it("registers the 5 built-in LLM providers", () => {
    const r = createProviderProfileRegistry();
    expect(r.profiles.size).toBe(5);
    for (const id of [
      "deepseek",
      "mistral",
      "openrouter",
      "openai-compatible",
      "llama.cpp",
    ]) {
      expect(resolveProviderProfile(r, id)?.id).toBe(id);
    }
  });

  it("maps built-in base URLs from config PROVIDER_API_BASES", () => {
    const r = createProviderProfileRegistry();
    expect(resolveProviderProfile(r, "deepseek")?.baseUrl).toBe(
      "https://api.deepseek.com",
    );
    expect(resolveProviderProfile(r, "mistral")?.baseUrl).toBe(
      "https://api.mistral.ai/v1",
    );
    expect(resolveProviderProfile(r, "llama.cpp")?.baseUrl).toBeUndefined();
  });

  it("resolves by alias as well as canonical name", () => {
    const r = createProviderProfileRegistry();
    expect(resolveProviderProfile(r, "llama-cpp")?.id).toBe("llama.cpp");
    expect(resolveProviderProfile(r, "llamacpp")?.id).toBe("llama.cpp");
    expect(resolveProviderProfile(r, "deepseek-chat")?.id).toBe("deepseek");
    expect(resolveProviderProfile(r, "open-router")?.id).toBe("openrouter");
  });

  it("returns null for an unknown name or alias", () => {
    const r = createProviderProfileRegistry();
    expect(resolveProviderProfile(r, "anthropic")).toBeNull();
    expect(resolveProviderProfile(r, "moonshot")).toBeNull();
  });

  it("last-writer-wins overrides a profile with the same name", () => {
    const r = createProviderProfileRegistry();
    registerProviderProfile(r, {
      ...base({ name: "deepseek", id: "deepseek" }),
      baseUrl: "https://override.example",
    });
    expect(resolveProviderProfile(r, "deepseek")?.baseUrl).toBe(
      "https://override.example",
    );
    expect(resolveProviderProfile(r, "deepseek-chat")?.baseUrl).toBe(
      "https://override.example",
    );
  });

  it("last-writer-wins repoints a colliding alias to the later profile", () => {
    const r = createProviderProfileRegistry();
    registerProviderProfile(r, base({ name: "a", aliases: ["shared"] }));
    registerProviderProfile(r, base({ name: "b", aliases: ["shared"] }));
    expect(resolveProviderProfile(r, "shared")?.name).toBe("b");
  });

  it("registering a fresh profile makes it resolvable by name and alias", () => {
    const r = createProviderProfileRegistry();
    registerProviderProfile(r, {
      ...base({ name: "my-provider", aliases: ["my-alias"] }),
    });
    expect(resolveProviderProfile(r, "my-provider")?.name).toBe("my-provider");
    expect(resolveProviderProfile(r, "my-alias")?.name).toBe("my-provider");
  });
});

describe("fetchModelsForProfile resolution chain", () => {
  const ok = { status: 200, headers: {}, body: textBody("{}") };

  it("prefers modelsUrl over baseUrl", async () => {
    mockInvoke.mockResolvedValue(ok);
    await fetchModelsForProfile(
      {
        id: "x",
        name: "x",
        baseUrl: "https://a.example/v1",
        modelsUrl: "https://catalog.example/v1/models",
      },
      null,
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      "ai_http_request",
      expect.objectContaining({
        url: "https://catalog.example/v1/models",
      }),
    );
  });

  it("falls back to baseUrl + /models when modelsUrl is absent", async () => {
    mockInvoke.mockResolvedValue(ok);
    await fetchModelsForProfile(
      { id: "x", name: "x", baseUrl: "https://a.example/v1/" },
      "secret",
    );
    const [, arg] = mockInvoke.mock.calls[0]!;
    expect((arg as { url: string }).url).toBe("https://a.example/v1/models");
    expect((arg as { headers?: Record<string, string> }).headers).toEqual({
      Authorization: "Bearer secret",
    });
  });

  it("returns [] when the profile has no resolvable endpoint", async () => {
    const models = await fetchModelsForProfile(
      { id: "x", name: "x" },
      null,
    );
    expect(models).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns [] on request failure instead of throwing", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    const models = await fetchModelsForProfile(
      { id: "x", name: "x", baseUrl: "https://a.example/v1" },
      null,
    );
    expect(models).toEqual([]);
  });

  it("parses a successful response through the profile chain", async () => {
    mockInvoke.mockResolvedValue({
      status: 200,
      headers: {},
      body: textBody(JSON.stringify({ data: [{ id: "m", context_length: 5 }] })),
    });
    const models = await fetchModelsForProfile(
      { id: "x", name: "x", baseUrl: "https://a.example/v1" },
      null,
    );
    expect(models).toEqual([{ id: "m", contextLength: 5, ownedBy: undefined }]);
  });
});

describe("fetchProviderModels profile wiring", () => {
  it("prefers a registered profile's modelsUrl over the legacy base", async () => {
    mockInvoke.mockResolvedValue({ status: 200, headers: {}, body: textBody("{}") });
    registerProviderProfile(DEFAULT_PROVIDER_REGISTRY, {
      id: "proxy",
      name: "proxy",
      modelsUrl: "https://proxy.example/models",
    });
    await fetchProviderModels("proxy" as never, "ignored", null);
    expect(mockInvoke).toHaveBeenCalledWith(
      "ai_http_request",
      expect.objectContaining({ url: "https://proxy.example/models" }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// Cover the SUCCESS branches of buildLanguageModel / buildConfiguredLanguageModel
// (the existing agent.test.ts only exercises the error branches). The provider
// SDK is dynamic-imported inside each case, so we mock it and assert the
// factory receives the right baseURL/apiKey/model id.

const { createCompatibleMock } = vi.hoisted(() => {
  const factory = vi.fn(() => {
    const builder = vi.fn(() => ({}));
    return builder;
  });
  return { createCompatibleMock: factory };
});

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (...args: unknown[]) => createCompatibleMock(...args),
}));

import { buildConfiguredLanguageModel, buildLanguageModel } from "./agent";
import type { ProviderKeys } from "./keyring";

const KEYS = {
  deepseek: "sk-ds",
  mistral: "sk-ms",
  openrouter: "sk-or",
  "openai-compatible": "sk-compat",
} as ProviderKeys;

beforeEach(() => {
  createCompatibleMock.mockClear();
});

describe("buildLanguageModel success branches", () => {
  it("deepseek uses the fixed DeepSeek base URL", async () => {
    await buildLanguageModel("deepseek", KEYS, "deepseek-v4");
    expect(createCompatibleMock).toHaveBeenCalledTimes(1);
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("https://api.deepseek.com");
    expect(opts.apiKey).toBe("sk-ds");
  });

  it("mistral uses the Mistral base URL", async () => {
    await buildLanguageModel("mistral", KEYS, "mistral-small-latest");
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("https://api.mistral.ai/v1");
    expect(opts.apiKey).toBe("sk-ms");
  });

  it("openrouter sends the referer + title headers", async () => {
    await buildLanguageModel("openrouter", KEYS, "anthropic/claude-sonnet-5");
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(opts.headers).toMatchObject({ "HTTP-Referer": "https://yamet.ai", "X-Title": "Yamet" });
  });

  it("openai-compatible passes the configured base URL and key", async () => {
    await buildLanguageModel(
      "openai-compatible",
      KEYS,
      "local-model",
      { openaiCompatibleBaseURL: "http://127.0.0.1:1234/v1" },
    );
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("http://127.0.0.1:1234/v1");
    expect(opts.apiKey).toBe("sk-compat");
  });

  it("openai-compatible prefers the endpoint key over the provider key", async () => {
    await buildLanguageModel(
      "openai-compatible",
      KEYS,
      "local-model",
      { openaiCompatibleBaseURL: "http://127.0.0.1:1234/v1" },
      "sk-endpoint",
    );
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.apiKey).toBe("sk-endpoint");
  });

  it("llama.cpp uses the default base URL with a fetch override", async () => {
    await buildLanguageModel("llama.cpp", KEYS, "qwen2.5-coder");
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("http://localhost:8080/v1");
    expect(typeof opts.fetch).toBe("function");
  });

  it("caches identical (provider, key, model, url) tuples — factory called once", async () => {
    const a = await buildLanguageModel("deepseek", KEYS, "deepseek-cache-a");
    const b = await buildLanguageModel("deepseek", KEYS, "deepseek-cache-a");
    expect(a).toBe(b);
    expect(createCompatibleMock).toHaveBeenCalledTimes(1);
  });

  it("does not share cached instances across different model ids", async () => {
    const a = await buildLanguageModel("deepseek", KEYS, "deepseek-share-a");
    const b = await buildLanguageModel("deepseek", KEYS, "deepseek-share-b");
    expect(a).not.toBe(b);
    expect(createCompatibleMock).toHaveBeenCalledTimes(2);
  });
});

describe("buildConfiguredLanguageModel success branches", () => {
  it("resolves a compat model to its endpoint and endpoint key", async () => {
    const model = await buildConfiguredLanguageModel("compat-ep1", KEYS, {
      customEndpoints: [
        { id: "ep1", name: "EP", baseURL: "http://10.0.0.5:8000/v1", modelId: "ep-model", contextLimit: 0 },
      ],
      customEndpointKeys: { ep1: "sk-ep" },
    });
    expect(model).toBeDefined();
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("http://10.0.0.5:8000/v1");
    expect(opts.apiKey).toBe("sk-ep");
  });

  it("resolves llama-cpp-local to the user-configured model id", async () => {
    await buildConfiguredLanguageModel("llama-cpp-local", KEYS, {
      llamaCppModelId: "qwen2.5-72b",
      llamaCppBaseURL: "http://127.0.0.1:1234/v1",
    });
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("http://127.0.0.1:1234/v1");
    // The builder is invoked with the resolved model id.
    const builder = createCompatibleMock.mock.results[0].value as (id: string) => unknown;
    expect(builder).toHaveBeenCalledWith("qwen2.5-72b");
  });

  it("resolves openrouter-custom to the user-configured model id", async () => {
    await buildConfiguredLanguageModel("openrouter-custom", KEYS, {
      openrouterModelId: "anthropic/claude-sonnet-5-custom",
    });
    const opts = createCompatibleMock.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.baseURL).toBe("https://openrouter.ai/api/v1");
    const builder = createCompatibleMock.mock.results[0].value as (id: string) => unknown;
    expect(builder).toHaveBeenCalledWith("anthropic/claude-sonnet-5-custom");
  });
});

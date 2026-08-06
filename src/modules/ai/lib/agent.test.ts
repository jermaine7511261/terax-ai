import { describe, expect, it } from "vitest";
import {
  buildConfiguredLanguageModel,
  buildLanguageModel,
  EMPTY_USAGE,
} from "./agent";
import type { ProviderKeys } from "./keyring";

const EMPTY_KEYS = {} as ProviderKeys;

describe("buildLanguageModel error branches", () => {
  it("throws when a key-requiring provider has no key configured", async () => {
    // deepseek requires an API key; empty keys must fail before any SDK import.
    await expect(
      buildLanguageModel("deepseek", EMPTY_KEYS, "deepseek-v4-flash"),
    ).rejects.toThrow(/No API key configured for deepseek/i);
  });

  it("throws when openai-compatible has no base URL", async () => {
    await expect(
      buildLanguageModel("openai-compatible", EMPTY_KEYS, "some-model", {}),
    ).rejects.toThrow(/no base URL/i);
  });

  it("throws for an unsupported provider", async () => {
    await expect(
      buildLanguageModel("not-a-provider" as never, {
        "not-a-provider": "k",
      } as unknown as ProviderKeys, "x"),
    ).rejects.toThrow(/Unsupported provider/i);
  });
});

describe("buildConfiguredLanguageModel error branches", () => {
  // buildConfiguredLanguageModel throws synchronously (it is not an async fn),
  // so assert with expect(() => ...).toThrow(...) rather than .rejects.
  it("throws for an unknown model id", () => {
    expect(() => buildConfiguredLanguageModel("does-not-exist", EMPTY_KEYS)).toThrow(
      /Unknown model/i,
    );
  });

  it("throws when a compat model id has no matching custom endpoint", () => {
    expect(() =>
      buildConfiguredLanguageModel("compat-missing-endpoint", EMPTY_KEYS, {}),
    ).toThrow(/Custom endpoint not found: missing-endpoint/i);
  });

  it("throws when the custom endpoint has no model id set", () => {
    const local = {
      customEndpoints: [
        { id: "ep1", name: "EP", baseURL: "http://localhost:1234", modelId: "", contextLimit: 0 },
      ],
    };
    expect(() =>
      buildConfiguredLanguageModel("compat-ep1", EMPTY_KEYS, local),
    ).toThrow(/no model id set/i);
  });

  it("throws when llama.cpp has no model id set", () => {
    expect(() =>
      buildConfiguredLanguageModel("llama-cpp-local", EMPTY_KEYS, {}),
    ).toThrow(/llama\.cpp: no model id set/i);
  });

  it("throws when openai-compatible-custom has no model id set", () => {
    expect(() =>
      buildConfiguredLanguageModel("openai-compatible-custom", EMPTY_KEYS, {}),
    ).toThrow(/OpenAI-compatible: no model id set/i);
  });

  it("throws when openrouter-custom has no model id set", () => {
    expect(() =>
      buildConfiguredLanguageModel("openrouter-custom", EMPTY_KEYS, {}),
    ).toThrow(/OpenRouter: no model id set/i);
  });
});

describe("EMPTY_USAGE", () => {
  it("is a zeroed usage snapshot", () => {
    expect(EMPTY_USAGE).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
  });
});

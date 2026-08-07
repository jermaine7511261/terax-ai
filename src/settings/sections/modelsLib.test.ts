import { describe, expect, it } from "vitest";
import {
  createEndpointDraft,
  fullyConfiguredEndpoints,
  isProviderConfigured,
  nextModelIdAfterEndpointRemoval,
  patchEndpoint,
  splitProviders,
} from "./modelsLib";
import {
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  type CustomEndpoint,
  type ProviderInfo,
  PROVIDERS,
  type ProviderId,
  providerNeedsKey,
} from "@/modules/ai/config";

const isLocal = (id: ProviderId): boolean => !providerNeedsKey(id);

const emptyDeps = {
  keys: null,
  openrouterModelId: "",
  compatBaseURL: "",
  localModelId: "",
};

describe("isProviderConfigured", () => {
  it("remote provider needs a stored key", () => {
    expect(isProviderConfigured("deepseek", { ...emptyDeps, keys: { deepseek: "k" } }, isLocal)).toBe(true);
    expect(isProviderConfigured("deepseek", emptyDeps, isLocal)).toBe(false);
  });

  it("openrouter additionally needs a model id", () => {
    expect(isProviderConfigured("openrouter", { ...emptyDeps, keys: { openrouter: "k" }, openrouterModelId: "m" }, isLocal)).toBe(true);
    expect(isProviderConfigured("openrouter", { ...emptyDeps, keys: { openrouter: "k" } }, isLocal)).toBe(false);
  });

  it("openai-compatible needs base URL and model id", () => {
    const base = { ...emptyDeps, keys: {} };
    expect(isProviderConfigured("openai-compatible", { ...base, compatBaseURL: " http://x ", localModelId: "" }, isLocal)).toBe(false);
    expect(isProviderConfigured("openai-compatible", { ...base, compatBaseURL: "http://x", localModelId: "m" }, isLocal)).toBe(true);
  });

  it("other local providers only need a model id", () => {
    expect(isProviderConfigured("llama.cpp", { ...emptyDeps, localModelId: "qwen" }, isLocal)).toBe(true);
    expect(isProviderConfigured("llama.cpp", emptyDeps, isLocal)).toBe(false);
  });
});

describe("splitProviders", () => {
  const all = PROVIDERS as readonly ProviderInfo[];

  it("configured providers are visible, others addable", () => {
    const { visible, addable } = splitProviders(
      all,
      new Set(["deepseek"]),
      new Set(),
    );
    expect(visible.map((p) => p.id)).toContain("deepseek");
    expect(visible.map((p) => p.id)).not.toContain("openai-compatible");
    expect(addable.map((p) => p.id)).toContain("mistral");
    expect(addable.map((p) => p.id)).not.toContain("deepseek");
  });

  it("adding a provider makes it visible", () => {
    const { visible } = splitProviders(all, new Set(), new Set(["mistral"]));
    expect(visible.map((p) => p.id)).toContain("mistral");
  });

  it("openai-compatible never appears in either list", () => {
    const { visible, addable } = splitProviders(
      all,
      new Set(["openai-compatible"]),
      new Set(),
    );
    expect(visible.some((p) => p.id === "openai-compatible")).toBe(false);
    expect(addable.some((p) => p.id === "openai-compatible")).toBe(false);
  });
});

describe("createEndpointDraft", () => {
  it("produces a blank endpoint with a short id", () => {
    const d = createEndpointDraft();
    expect(d.name).toBe("");
    expect(d.baseURL).toBe("");
    expect(d.modelId).toBe("");
    expect(d.contextLimit).toBe(128_000);
    expect(d.id).toMatch(/^[0-9a-f]{8}$/);
    expect(createEndpointDraft().id).not.toBe(createEndpointDraft().id);
  });
});

describe("patchEndpoint", () => {
  it("merges patch into the matching endpoint only", () => {
    const list: CustomEndpoint[] = [
      { id: "a", name: "A", baseURL: "", modelId: "", contextLimit: 1 },
      { id: "b", name: "B", baseURL: "", modelId: "", contextLimit: 2 },
    ];
    const out = patchEndpoint(list, "b", { name: "B2" });
    expect(out[0]).toBe(list[0]);
    expect(out[1].name).toBe("B2");
    expect(out[1].contextLimit).toBe(2);
  });

  it("unknown id returns an unchanged copy", () => {
    const list = [{ id: "a" }];
    expect(patchEndpoint(list, "nope", {})).toEqual(list);
  });
});

describe("nextModelIdAfterEndpointRemoval", () => {
  const ep: CustomEndpoint = { id: "e1", name: "", baseURL: "http://x", modelId: "m", contextLimit: 100 };

  it("keeps the selection when the dead endpoint is not active", () => {
    expect(nextModelIdAfterEndpointRemoval("gpt-4o", "e1", [ep])).toBe("gpt-4o");
  });

  it("falls back to the first remaining endpoint when active", () => {
    const fallback = compatModelIdForEndpoint("e1");
    expect(nextModelIdAfterEndpointRemoval(fallback, fallback, [ep])).toBe(fallback);
  });

  it("falls back to the default model when nothing remains", () => {
    expect(nextModelIdAfterEndpointRemoval("x", "x", [])).toBe(DEFAULT_MODEL_ID);
  });
});

describe("fullyConfiguredEndpoints", () => {
  it("keeps only endpoints with base URL and model id", () => {
    const eps: CustomEndpoint[] = [
      { id: "a", name: "", baseURL: "http://a", modelId: "m1", contextLimit: 1 },
      { id: "b", name: "", baseURL: "  ", modelId: "m2", contextLimit: 1 },
      { id: "c", name: "", baseURL: "http://c", modelId: "", contextLimit: 1 },
    ];
    expect(fullyConfiguredEndpoints(eps).map((e) => e.id)).toEqual(["a"]);
  });
});

import { invoke } from "@/platform";
import { create } from "zustand";
import {
  type ProviderId,
  PROVIDER_API_BASES,
} from "@/modules/ai/config";

export type FetchedModel = {
  id: string;
  contextLength?: number;
  ownedBy?: string;
};

type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: number[];
};

/** Resolve the API base (without trailing `/models`) for a provider. */
export function providerApiBase(
  provider: ProviderId,
  baseURL: string,
): string {
  if (provider === "llama.cpp" || provider === "openai-compatible") {
    return baseURL.replace(/\/+$/, "");
  }
  return PROVIDER_API_BASES[provider] ?? baseURL.replace(/\/+$/, "");
}

// ── ProviderProfile declarative registry ──────────────────────────────────
// Pure-additive. Mirrors the design of hermes' provider profile registry
// (providers/base.py + providers/__init__.py): a provider is described
// declaratively, registered by canonical name + aliases (last-writer-wins),
// and resolved lazily by name or alias with a models-endpoint resolution
// chain (modelsUrl → baseUrl → baseUrl + "/models").

export type ProviderProfile = {
  id: string;
  name: string;
  aliases?: readonly string[];
  baseUrl?: string;
  modelsUrl?: string;
  authType?: "none" | "bearer" | "api-key";
  keyOptional?: boolean;
  supportsVision?: boolean;
  supportsHealthCheck?: boolean;
};

export type ProviderProfileRegistry = {
  profiles: Map<string, ProviderProfile>;
  aliases: Map<string, string>;
};

/** Register a profile by canonical name + aliases. Later registrations of the
 *  same name/alias overwrite earlier ones (last-writer-wins, hermes semantics). */
export function registerProviderProfile(
  registry: ProviderProfileRegistry,
  profile: ProviderProfile,
): void {
  registry.profiles.set(profile.name, profile);
  for (const alias of profile.aliases ?? []) {
    registry.aliases.set(alias, profile.name);
  }
}

/** Look up a profile by exact canonical name first, then by alias. Returns
 *  null when neither matches. */
export function resolveProviderProfile(
  registry: ProviderProfileRegistry,
  nameOrAlias: string,
): ProviderProfile | null {
  const canonical = registry.aliases.get(nameOrAlias) ?? nameOrAlias;
  return registry.profiles.get(canonical) ?? null;
}

/** Build a fresh registry pre-populated with the built-in LLM providers,
 *  mapping fields from config.ts PROVIDERS + PROVIDER_API_BASES. */
export function createProviderProfileRegistry(): ProviderProfileRegistry {
  const registry: ProviderProfileRegistry = {
    profiles: new Map(),
    aliases: new Map(),
  };
  registerProviderProfile(registry, {
    id: "deepseek",
    name: "deepseek",
    aliases: ["deepseek-chat"],
    baseUrl: PROVIDER_API_BASES.deepseek,
    authType: "bearer",
    supportsVision: false,
    supportsHealthCheck: true,
  });
  registerProviderProfile(registry, {
    id: "mistral",
    name: "mistral",
    aliases: ["mistral-ai"],
    baseUrl: PROVIDER_API_BASES.mistral,
    authType: "bearer",
    supportsVision: true,
    supportsHealthCheck: true,
  });
  registerProviderProfile(registry, {
    id: "openrouter",
    name: "openrouter",
    aliases: ["open-router"],
    baseUrl: PROVIDER_API_BASES.openrouter,
    authType: "bearer",
    supportsVision: true,
    supportsHealthCheck: true,
  });
  registerProviderProfile(registry, {
    id: "openai-compatible",
    name: "openai-compatible",
    aliases: ["openai"],
    authType: "api-key",
    keyOptional: true,
    supportsVision: false,
    supportsHealthCheck: true,
  });
  registerProviderProfile(registry, {
    id: "llama.cpp",
    name: "llama.cpp",
    aliases: ["llamacpp", "llama-cpp"],
    authType: "none",
    keyOptional: true,
    supportsVision: false,
    supportsHealthCheck: false,
  });
  return registry;
}

/** Default registry with the built-in providers. Used by fetchProviderModels
 *  as the first choice in its resolution chain. */
export const DEFAULT_PROVIDER_REGISTRY: ProviderProfileRegistry =
  createProviderProfileRegistry();

/**
 * Resolve the models endpoint URL for a profile.
 * Resolution chain: modelsUrl → baseUrl → caller-supplied base URL → null.
 * Mirrors hermes `ProviderProfile.fetch_models` ordering.
 */
function resolveProfileModelsUrl(
  profile: ProviderProfile,
  callerBaseURL: string,
): string | null {
  if (profile.modelsUrl) return profile.modelsUrl;
  const base = (profile.baseUrl || callerBaseURL).replace(/\/+$/, "");
  if (!base) return null;
  return new URL("models", base.endsWith("/") ? base : `${base}/`).toString();
}

/**
 * Shared SSRF-guarded GET + parse of a `/models` endpoint. Throws on failure
 * so callers decide whether to surface (fetchProviderModels) or swallow
 * (fetchModelsForProfile) the error.
 */
async function httpFetchModels(
  url: string,
  apiKey: string | null,
): Promise<FetchedModel[]> {
  const res = await invoke<HttpResponse>("ai_http_request", {
    url,
    method: "GET",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    allowPrivateNetwork: true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`模型列表请求失败（HTTP ${res.status}）`);
  }
  const text = new TextDecoder().decode(new Uint8Array(res.body));
  const json = JSON.parse(text) as { data?: unknown };
  const data = Array.isArray(json?.data) ? json.data : [];
  const models: FetchedModel[] = [];
  for (const m of data) {
    if (m && typeof (m as { id?: unknown }).id === "string") {
      const rec = m as {
        id: string;
        context_length?: unknown;
        contextLength?: unknown;
        owned_by?: unknown;
      };
      models.push({
        id: rec.id,
        contextLength:
          typeof rec.context_length === "number"
            ? rec.context_length
            : typeof rec.contextLength === "number"
              ? rec.contextLength
              : undefined,
        ownedBy: typeof rec.owned_by === "string" ? rec.owned_by : undefined,
      });
    }
  }
  return models;
}

/**
 * Fetch a provider's model list via its declarative profile, using the
 * modelsUrl → baseUrl → baseUrl+"/models" resolution chain. Returns [] when
 * no endpoint can be resolved or the request fails (never throws).
 */
export async function fetchModelsForProfile(
  profile: ProviderProfile,
  apiKey: string | null,
): Promise<FetchedModel[]> {
  const url = resolveProfileModelsUrl(profile, "");
  if (!url) return [];
  try {
    return await httpFetchModels(url, apiKey);
  } catch {
    return [];
  }
}

/**
 * Fetch the provider's model list from its OpenAI-compatible `/models`
 * endpoint, routed through the Rust SSRF-guarded proxy.
 *
 * Resolution prefers the declarative ProviderProfile chain (modelsUrl →
 * baseUrl → caller base URL) when a profile resolves for the provider; when no
 * profile or no endpoint resolves, it falls back to the legacy
 * `providerApiBase` logic. Throws on non-2xx / network failure.
 */
export async function fetchProviderModels(
  provider: ProviderId,
  baseURL: string,
  apiKey: string | null,
): Promise<FetchedModel[]> {
  const profile = resolveProviderProfile(DEFAULT_PROVIDER_REGISTRY, provider);
  const url =
    (profile && resolveProfileModelsUrl(profile, baseURL)) ??
    new URL(
      "models",
      `${providerApiBase(provider, baseURL).replace(/\/+$/, "")}/`,
    ).toString();
  return httpFetchModels(url, apiKey);
}

type FetchedState = {
  cache: Record<string, FetchedModel[]>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
  set: (key: string, models: FetchedModel[]) => void;
  setLoading: (key: string, loading: boolean) => void;
  setError: (key: string, error: string | null) => void;
};

export const useFetchedModelsStore = create<FetchedState>((set) => ({
  cache: {},
  loading: {},
  error: {},
  set: (key, models) =>
    set((s) => ({ cache: { ...s.cache, [key]: models } })),
  setLoading: (key, loading) =>
    set((s) => ({ loading: { ...s.loading, [key]: loading } })),
  setError: (key, error) =>
    set((s) => ({ error: { ...s.error, [key]: error } })),
}));

/**
 * Fetch and cache models for a provider, keyed by its base URL so local and
 * compatible endpoints (and the same provider with different endpoints) never
 * collide. Returns the cached list plus loading/error state.
 */
export async function refreshProviderModels(
  provider: ProviderId,
  baseURL: string,
  apiKey: string | null,
): Promise<FetchedModel[]> {
  const key = `${provider}::${providerApiBase(provider, baseURL)}`;
  const store = useFetchedModelsStore.getState();
  store.setLoading(key, true);
  store.setError(key, null);
  try {
    const models = await fetchProviderModels(provider, baseURL, apiKey);
    store.set(key, models);
    return models;
  } catch (e) {
    store.setError(key, e instanceof Error ? e.message : String(e));
    return store.cache[key] ?? [];
  } finally {
    store.setLoading(key, false);
  }
}

// Stable shared empty list. A missing cache entry must not yield a fresh
// array reference every render — useSyncExternalStore would treat each new
// reference as a store change and forceStoreRerender in an infinite loop
// (React #185 "Maximum update depth exceeded").
const EMPTY_MODELS: FetchedModel[] = [];

export function useFetchedModels(
  provider: ProviderId,
  baseURL: string,
  apiKey: string | null,
): {
  models: FetchedModel[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<FetchedModel[]>;
} {
  const key = `${provider}::${providerApiBase(provider, baseURL)}`;
  const models = useFetchedModelsStore((s) => s.cache[key] ?? EMPTY_MODELS);
  const loading = useFetchedModelsStore((s) => s.loading[key] ?? false);
  const error = useFetchedModelsStore((s) => s.error[key] ?? null);
  return {
    models,
    loading,
    error,
    refresh: () => refreshProviderModels(provider, baseURL, apiKey),
  };
}

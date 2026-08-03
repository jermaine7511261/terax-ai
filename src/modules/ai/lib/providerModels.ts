import { invoke } from "@tauri-apps/api/core";
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

/**
 * Fetch the provider's model list from its OpenAI-compatible `/models`
 * endpoint, routed through the Rust SSRF-guarded proxy.
 */
export async function fetchProviderModels(
  provider: ProviderId,
  baseURL: string,
  apiKey: string | null,
): Promise<FetchedModel[]> {
  const base = providerApiBase(provider, baseURL);
  const url = new URL("models", base.endsWith("/") ? base : `${base}/`);
  const res = await invoke<HttpResponse>("ai_http_request", {
    url: url.toString(),
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

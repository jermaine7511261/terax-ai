/**
 * Pure model-config logic extracted from ModelsSection so it can be unit
 * tested without mounting the settings UI. No React, no store access — all
 * inputs are passed in.
 */
import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  type ModelId,
  type ProviderId,
  type ProviderInfo,
} from "@/modules/ai/config";

export type ConfiguredDeps = {
  keys: Record<string, string | null> | null;
  openrouterModelId: string;
  /** openai-compatible base URL (empty for other providers). */
  compatBaseURL: string;
  /** llama.cpp / openai-compatible model id (empty for other providers). */
  localModelId: string;
};

/**
 * Whether a provider is fully usable: remote providers need a stored key
 * (openrouter additionally needs a model id), local providers need their
 * config fields filled in.
 */
export function isProviderConfigured(
  id: ProviderId,
  d: ConfiguredDeps,
  isLocal: (id: ProviderId) => boolean,
): boolean {
  if (id === "openrouter") return !!d.keys?.[id] && !!d.openrouterModelId.trim();
  if (!isLocal(id)) return !!d.keys?.[id];
  if (id === "openai-compatible") return !!d.compatBaseURL.trim() && !!d.localModelId.trim();
  return !!d.localModelId.trim();
}

/**
 * Partition providers into "visible" (configured or currently being added)
 * and "addable". The openai-compatible entry is a virtual provider backed by
 * named custom endpoints, so it never appears in either list.
 */
export function splitProviders(
  all: readonly ProviderInfo[],
  configuredIds: ReadonlySet<ProviderId>,
  adding: ReadonlySet<ProviderId>,
): { visible: ProviderInfo[]; addable: ProviderInfo[] } {
  const visibleIds = new Set<ProviderId>(configuredIds);
  for (const id of adding) visibleIds.add(id);
  const visible = all.filter(
    (p) => p.id !== "openai-compatible" && visibleIds.has(p.id),
  );
  const addable = all.filter(
    (p) => p.id !== "openai-compatible" && !visibleIds.has(p.id),
  );
  return { visible, addable };
}

/** Draft for a newly added OpenAI-compatible custom endpoint. */
export function createEndpointDraft(): CustomEndpoint {
  return {
    id: crypto.randomUUID().slice(0, 8),
    name: "",
    baseURL: "",
    modelId: "",
    contextLimit: 128_000,
  };
}

/** Immutably merge `patch` into the endpoint whose id matches. */
export function patchEndpoint<T extends { id: string }>(
  list: readonly T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return list.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

/**
 * What the selected model id should become after a custom endpoint is
 * removed: unchanged unless the dead endpoint was the active selection, in
 * which case fall back to the first remaining endpoint (else default).
 */
export function nextModelIdAfterEndpointRemoval(
  selectedModelId: string,
  deadModelId: string,
  remaining: readonly CustomEndpoint[],
  defaultModelId: ModelId = DEFAULT_MODEL_ID,
): ModelId {
  if (selectedModelId !== deadModelId) return selectedModelId as ModelId;
  return remaining[0]
    ? (compatModelIdForEndpoint(remaining[0].id) as ModelId)
    : defaultModelId;
}

/** Endpoints that have both a base URL and a model id (selectable in AI). */
export function fullyConfiguredEndpoints(
  endpoints: readonly CustomEndpoint[],
): CustomEndpoint[] {
  return endpoints.filter((e) => e.baseURL.trim() && e.modelId.trim());
}

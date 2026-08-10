import type { LanguageModel } from "ai";
import type { CustomEndpoint } from "../config";
import type { CustomEndpointKeys, ProviderKeys } from "./keyring";
import { native } from "./native";
import { buildConfiguredLanguageModel } from "./agent";

/**
 * R30 §2.1: cross-provider failover for non-streaming model calls.
 *
 * The main chat stream handles fallback in transport.ts; every generateText
 * call site (subagents, graph judge, commit-message generation) routes
 * through here so a 429/5xx/network failure on the primary provider
 * transparently retries against the user's configured fallback chain, and
 * every attempt is recorded into the Rust circuit breaker (which drives the
 * settings-panel status dots).
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableModelError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message ?? "";
  // Never retry user aborts.
  if (/aborted|AbortError/i.test(msg)) return false;
  const status =
    (e as { statusCode?: number }).statusCode ??
    (e as { status?: number }).status;
  if (typeof status === "number") {
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }
  return /(429|rate.?limit|too many requests|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|socket hang up|network error)/i.test(
    msg,
  );
}

export type ModelBuildOptions = {
  llamaCppBaseURL?: string;
  llamaCppModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openrouterModelId?: string;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
};

/**
 * Self-heal / reset semantics (mirrors conversation_loop's
 * `_try_recover_primary_transport` — the idea is borrowed, not the code):
 *
 * - The PRIMARY link (order[0]) gets ONE self-heal attempt on its first
 *   retryable failure: instead of immediately hopping to a fallback provider,
 *   we wait a short backoff (equivalent to recreating the connection or
 *   letting a rate-limit window pass) and retry the SAME primary provider
 *   once. Only if that self-heal also fails do we move down the chain.
 * - Secondary providers in the chain get a single attempt each — they do NOT
 *   get a self-heal retry.
 * - After a NEW provider succeeds we call `native.resilienceRecordSuccess(id)`,
 *   which RESETS the circuit-breaker state for that provider so it does not
 *   carry forward any prior failure / open-breaker state. Local counters
 *   (e.g. `selfHealed`) are scoped to a single call and are naturally reset on
 *   the next `generateTextWithFallback`.
 * - Non-retryable errors are rethrown immediately (no self-heal, no fallback),
 *   matching existing behavior.
 */
export async function generateTextWithFallback<T>(opts: {
  modelId: string;
  keys: ProviderKeys;
  chain: readonly string[];
  buildOpts?: ModelBuildOptions;
  run: (model: LanguageModel) => Promise<T>;
}): Promise<T> {
  const order = Array.from(new Set([opts.modelId, ...opts.chain]));
  const primary = order[0];
  const SELF_HEAL_BACKOFF_MS = 800;
  let lastErr: unknown;
  // One-time self-heal budget, scoped to this call (resets each invocation).
  let selfHealed = false;

  const attempt = async (id: string): Promise<T> => {
    const model = await buildConfiguredLanguageModel(id, opts.keys, {
      llamaCppBaseURL: opts.buildOpts?.llamaCppBaseURL,
      llamaCppModelId: opts.buildOpts?.llamaCppModelId,
      openaiCompatibleBaseURL: opts.buildOpts?.openaiCompatibleBaseURL,
      openaiCompatibleModelId: opts.buildOpts?.openaiCompatibleModelId,
      openrouterModelId: opts.buildOpts?.openrouterModelId,
      customEndpoints: opts.buildOpts?.customEndpoints,
      customEndpointKeys: opts.buildOpts?.customEndpointKeys,
    });
    return opts.run(model);
  };

  for (const id of order) {
    if (!(await native.resilienceAvailable(id))) continue;
    try {
      const result = await attempt(id);
      // Record success: resets the breaker for this provider so a prior
      // failure/open state is not carried forward.
      void native.resilienceRecordSuccess(id);
      return result;
    } catch (e) {
      lastErr = e;
      void native.resilienceRecordFailure(id);
      if (!isRetryableModelError(e)) throw e;

      // Self-heal the PRIMARY link once before falling back to the chain.
      if (id === primary && !selfHealed) {
        selfHealed = true;
        console.warn(
          `[resilience] primary ${id} transient failure, self-healing after ${SELF_HEAL_BACKOFF_MS}ms: ${String(e)}`,
        );
        await sleep(SELF_HEAL_BACKOFF_MS);
        try {
          const result = await attempt(id);
          void native.resilienceRecordSuccess(id);
          return result;
        } catch (e2) {
          lastErr = e2;
          void native.resilienceRecordFailure(id);
          if (!isRetryableModelError(e2)) throw e2;
          console.warn(
            `[resilience] primary ${id} self-heal failed, trying fallback: ${String(e2)}`,
          );
          continue;
        }
      }

      console.warn(`[resilience] provider ${id} failed, trying next: ${String(e)}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

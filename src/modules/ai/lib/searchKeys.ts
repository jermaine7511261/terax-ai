import { invoke } from "@/platform";
import { KEYRING_SERVICE } from "../config";

/**
 * Search provider API keys (Exa / Parallel).
 *
 * These providers are not members of the `ProviderId` union and are not part of
 * the model registry, so they get their own keyring wrapper instead of living in
 * keyring.ts. Keys are stored in the same OS keyring as provider keys, using the
 * same `secrets_get`/`secrets_set`/`secrets_delete` commands with a custom
 * `account` (`exa-api-key` / `parallel-api-key`).
 */
export type SearchProvider = "exa" | "parallel";

function accountFor(which: SearchProvider): string {
  return `${which}-api-key`;
}

export async function getSearchKey(
  which: SearchProvider,
): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: accountFor(which),
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setSearchKey(
  which: SearchProvider,
  key: string,
): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: accountFor(which),
    password: trimmed,
  });
}

export async function clearSearchKey(
  which: SearchProvider,
): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: accountFor(which),
    });
  } catch {
    // already absent — fine
  }
}

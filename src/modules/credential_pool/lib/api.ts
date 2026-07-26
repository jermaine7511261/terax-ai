import { invoke } from "@tauri-apps/api/core";

export type CredentialSourceType = "env" | "file" | "keyring" | "inline" | "vault";

export type CredentialSource = {
  id: string;
  provider: string;
  source_type: CredentialSourceType;
  priority: number;
  is_active: boolean;
  last_error: string | null;
};

export type ResolvedCredential = {
  provider: string;
  api_key: string;
  source_id: string;
};

export async function cpListSources(): Promise<CredentialSource[]> {
  return invoke("cp_list_sources");
}

export async function cpRegisterSource(source: CredentialSource): Promise<void> {
  return invoke("cp_register_source", { source });
}

export async function cpRemoveSource(id: string): Promise<void> {
  return invoke("cp_remove_source", { id });
}

export async function cpResolve(provider: string): Promise<ResolvedCredential> {
  return invoke("cp_resolve", { provider });
}

export async function cpSetInMemory(provider: string, apiKey: string): Promise<void> {
  return invoke("cp_set_in_memory", { provider, apiKey });
}

export async function cpInvalidate(provider: string): Promise<void> {
  return invoke("cp_invalidate", { provider });
}

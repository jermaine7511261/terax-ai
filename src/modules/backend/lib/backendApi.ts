import { invoke } from "@tauri-apps/api/core";

export type BackendKind = "Local" | "Docker" | "SSH";

export type BackendConfig = {
  id: string;
  name: string;
  kind: BackendKind;
  host: string | null;
  port: number | null;
  user: string | null;
  identity_file: string | null;
  container: string | null;
  image: string | null;
  work_dir: string | null;
  env: Record<string, string> | null;
  enabled: boolean;
};

export type BackendStatus = {
  id: string;
  name: string;
  kind: BackendKind;
  connected: boolean;
  latency_ms: number | null;
  error: string | null;
};

export async function listBackends(): Promise<BackendConfig[]> {
  return invoke("backend_list");
}

export async function registerBackend(config: BackendConfig): Promise<void> {
  return invoke("backend_register", { config });
}

export async function removeBackend(id: string): Promise<void> {
  return invoke("backend_remove", { id });
}

export async function executeOnBackend(
  backendId: string,
  command: string,
  workDir?: string,
): Promise<string> {
  return invoke("backend_execute", {
    backendId,
    command,
    workDir: workDir ?? null,
  });
}

export async function backendStatus(id: string): Promise<BackendStatus> {
  return invoke("backend_status", { id });
}

export async function backendStatusAll(): Promise<BackendStatus[]> {
  return invoke("backend_status_all");
}

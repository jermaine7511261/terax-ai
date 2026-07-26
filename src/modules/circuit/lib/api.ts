import { invoke } from "@tauri-apps/api/core";

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreaker = {
  name: string;
  state: CircuitState;
  failure_count: number;
  success_count: number;
  last_failure: string | null;
  last_success: string | null;
  opened_at: string | null;
  threshold: number;
  timeout_secs: number;
};

export async function cbList(): Promise<CircuitBreaker[]> {
  return invoke("cb_list");
}

export async function cbGet(name: string): Promise<CircuitBreaker> {
  return invoke("cb_get", { name });
}

export async function cbRegister(name: string, threshold?: number, timeoutSecs?: number): Promise<void> {
  return invoke("cb_register", { name, threshold: threshold ?? null, timeoutSecs: timeoutSecs ?? null });
}

export async function cbCallAllowed(name: string): Promise<boolean> {
  return invoke("cb_call_allowed", { name });
}

export async function cbRecordSuccess(name: string): Promise<void> {
  return invoke("cb_record_success", { name });
}

export async function cbRecordFailure(name: string): Promise<void> {
  return invoke("cb_record_failure", { name });
}

export async function cbReset(name: string): Promise<void> {
  return invoke("cb_reset", { name });
}

import { invoke } from "@tauri-apps/api/core";

export type ErrorCategory =
  | "auth" | "rate_limit" | "timeout" | "network" | "parse"
  | "provider" | "model" | "tool" | "internal" | "unknown";

export type ClassifiedError = {
  id: string;
  timestamp: string;
  category: ErrorCategory;
  raw_message: string;
  source: string;
  provider: string | null;
  model: string | null;
  tool: string | null;
  recovered: boolean;
  recovery_action: string | null;
  frequency: number;
};

export type ErrorStats = {
  total: number;
  by_category: Record<string, number>;
  recovered: number;
  unresolved: number;
};

export async function errorsClassify(message: string, source?: string): Promise<ClassifiedError> {
  return invoke("errors_classify", { message, source: source ?? null });
}

export async function errorsStats(): Promise<ErrorStats> {
  return invoke("errors_stats");
}

export async function errorsRecent(limit?: number): Promise<ClassifiedError[]> {
  return invoke("errors_recent", { limit: limit ?? 50 });
}

export async function errorsMarkRecovered(id: string): Promise<void> {
  return invoke("errors_mark_recovered", { id });
}

export async function errorsAutoFix(id: string): Promise<string> {
  return invoke("errors_auto_fix", { id });
}

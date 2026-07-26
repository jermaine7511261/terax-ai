import { invoke } from "@tauri-apps/api/core";

export type ProviderBreakdown = {
  provider: string;
  queries: number;
  cost_usd: number;
};

export type DailyCost = {
  date: string;
  cost_usd: number;
  queries: number;
};

export type UsageSummary = {
  total_queries: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_provider: ProviderBreakdown[];
  daily_costs: DailyCost[];
  estimated_monthly_cost: number;
};

export type BudgetConfig = {
  monthly_budget_usd: number;
  per_query_limit_usd: number;
  alert_threshold: number;
  enabled: boolean;
};

export type UsageRecord = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export async function billingRecord(record: UsageRecord): Promise<void> {
  return invoke("billing_record", { record });
}

export async function billingSummary(): Promise<UsageSummary> {
  return invoke("billing_summary");
}

export async function billingGetBudget(): Promise<BudgetConfig> {
  return invoke("billing_get_budget");
}

export async function billingSetBudget(budget: BudgetConfig): Promise<void> {
  return invoke("billing_set_budget", { budget });
}

export async function billingRecent(limit?: number): Promise<UsageRecord[]> {
  return invoke("billing_recent", { limit: limit ?? 50 });
}

export async function billingCalculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number> {
  return invoke("billing_calculate_cost", { provider, model, inputTokens, outputTokens });
}

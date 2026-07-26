import { invoke } from "@tauri-apps/api/core";

export type MoaStrategy =
  | { type: "aggregate" }
  | { type: "round_robin"; chunk_size?: number }
  | { type: "weighted"; weights: Record<string, number> }
  | { type: "fallback" }
  | { type: "vote"; min_votes?: number };

export type MoaModel = {
  id: string;
  provider: string;
  model: string;
  priority: number;
  weight: number;
  capabilities: string[];
  cost_per_1k: number;
};

export type MoaPlan = {
  models: MoaModel[];
  strategy: MoaStrategy;
  max_parallel: number;
  timeout_ms: number;
  aggregate_prompt: string;
};

export async function moaRegister(model: MoaModel): Promise<void> {
  return invoke("moa_register", { model });
}

export async function moaUnregister(id: string): Promise<void> {
  return invoke("moa_unregister", { id });
}

export async function moaList(): Promise<MoaModel[]> {
  return invoke("moa_list");
}

export async function moaSelect(plan: MoaPlan): Promise<string> {
  return invoke("moa_select", { plan });
}

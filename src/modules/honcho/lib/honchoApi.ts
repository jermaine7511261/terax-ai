import { invoke } from "@tauri-apps/api/core";

export type HonchoInsight = {
  category: string;
  summary: string;
  confidence: number;
  supporting_observations: string[];
  first_observed: string;
  last_observed: string;
};

export async function getInsights(): Promise<HonchoInsight[]> {
  return invoke("honcho_insights");
}

export async function observe(sessionId: string, observation: string, category: string): Promise<void> {
  return invoke("honcho_observe", { sessionId, observation, category });
}

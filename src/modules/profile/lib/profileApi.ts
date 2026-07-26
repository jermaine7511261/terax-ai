import { invoke } from "@tauri-apps/api/core";

export type UserTrait = {
  name: string;
  confidence: number;
  observed_at: string;
  evidence: string;
};

export type UserProfile = {
  name: string;
  role: string;
  preferences: Record<string, string>;
  model_preference: string;
  agent_mode: string;
  skill_auto_create: boolean;
  learning_enabled: boolean;
  memory_enabled: boolean;
  created_at: string;
  updated_at: string;
  traits: UserTrait[];
  recent_goals: string[];
};

export async function getProfile(): Promise<UserProfile> {
  return invoke("profile_get");
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  return invoke("profile_save", { profile });
}

export async function getProfileMarkdown(): Promise<string> {
  return invoke("profile_get_markdown");
}

export async function recordGoal(goal: string): Promise<void> {
  return invoke("profile_record_goal", { goal });
}

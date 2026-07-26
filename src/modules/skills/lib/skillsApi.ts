import { invoke } from "@tauri-apps/api/core";

export type SkillDef = {
  id: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  version: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
};

export async function listSkills(): Promise<SkillDef[]> {
  return invoke("skills_list");
}

export async function getSkill(id: string): Promise<SkillDef | null> {
  return invoke("skills_get", { id });
}

export async function createSkill(skill: SkillDef): Promise<void> {
  return invoke("skills_create", { skill });
}

export async function deleteSkill(id: string): Promise<void> {
  return invoke("skills_delete", { id });
}

export async function useSkill(id: string): Promise<void> {
  return invoke("skills_use", { id });
}

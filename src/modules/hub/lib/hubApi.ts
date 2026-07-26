import { invoke } from "@tauri-apps/api/core";

export type HubSkill = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  license: string;
  tags: string[];
  installs: number;
  rating: number;
  source_url: string | null;
  instructions: string;
  updated_at: string;
};

export type InstalledSkill = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  license: string;
  tags: string[];
  installed_at: string;
  updated_at: string;
  instructions: string;
  enabled: boolean;
  source_url: string | null;
};

export async function refreshIndex(): Promise<HubSkill[]> {
  return invoke("hub_refresh");
}

export async function searchHub(query: string): Promise<HubSkill[]> {
  return invoke("hub_search", { query });
}

export async function installSkill(skillId: string): Promise<InstalledSkill> {
  return invoke("hub_install", { skillId });
}

export async function uninstallSkill(id: string): Promise<void> {
  return invoke("hub_uninstall", { id });
}

export async function listInstalled(): Promise<InstalledSkill[]> {
  return invoke("hub_list_installed");
}

export async function getInstalled(id: string): Promise<InstalledSkill | null> {
  return invoke("hub_get_installed", { id });
}

export async function toggleSkill(id: string, enabled: boolean): Promise<void> {
  return invoke("hub_toggle", { id, enabled });
}

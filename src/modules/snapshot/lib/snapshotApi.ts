import { invoke } from "@tauri-apps/api/core";

export type MemorySnapshot = {
  id: string;
  label: string;
  created_at: string;
  memory_count: number;
  session_count: number;
  skill_count: number;
};

export async function createSnapshot(label: string, memoryCount: number, sessionCount: number, skillCount: number): Promise<MemorySnapshot> {
  return invoke("ms_create", { label, memoryCount, sessionCount, skillCount });
}

export async function listSnapshots(): Promise<MemorySnapshot[]> {
  return invoke("ms_list");
}

export async function deleteSnapshot(id: string): Promise<void> {
  return invoke("ms_delete", { id });
}

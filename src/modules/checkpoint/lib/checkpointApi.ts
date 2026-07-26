import { invoke } from "@tauri-apps/api/core";

export type Checkpoint = {
  id: string;
  label: string;
  created_at: string;
  file_count: number;
};

export async function createCheckpoint(label: string): Promise<Checkpoint> {
  return invoke("checkpoint_create", { label });
}

export async function listCheckpoints(): Promise<Checkpoint[]> {
  return invoke("checkpoint_list");
}

export async function restoreCheckpoint(id: string): Promise<number> {
  return invoke("checkpoint_restore", { id });
}

export async function deleteCheckpoint(id: string): Promise<void> {
  return invoke("checkpoint_delete", { id });
}

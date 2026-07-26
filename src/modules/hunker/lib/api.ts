import { invoke } from "@tauri-apps/api/core";

export type Hunk = {
  id: string;
  file: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  content: string;
  committed: boolean;
};

export type HunkGroup = {
  id: string;
  hunks: Hunk[];
  description: string;
  created_at: string;
};

export async function hunkRecord(file: string, oldStart: number, newStart: number, content: string): Promise<Hunk> {
  return invoke("hunk_record", { file, oldStart, newStart, content });
}

export async function hunkList(file?: string): Promise<Hunk[]> {
  return invoke("hunk_list", { file: file ?? null });
}

export async function hunkGet(id: string): Promise<Hunk> {
  return invoke("hunk_get", { id });
}

export async function hunkApply(id: string): Promise<void> {
  return invoke("hunk_apply", { id });
}

export async function hunkDelete(id: string): Promise<void> {
  return invoke("hunk_delete", { id });
}

export async function hunkCleanup(): Promise<number> {
  return invoke("hunk_cleanup");
}

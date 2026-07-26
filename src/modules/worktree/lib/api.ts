import { invoke } from "@tauri-apps/api/core";

export type ChangeKind = "created" | "modified" | "deleted" | "renamed";

export type FileChange = {
  path: string;
  kind: ChangeKind;
  timestamp: string;
  size_bytes: number;
  hash: string;
};

export type WorktreeSnapshot = {
  id: string;
  timestamp: string;
  file_count: number;
  changes: FileChange[];
};

export async function wtSnapshot(): Promise<number> {
  return invoke("wt_snapshot");
}

export async function wtDiff(): Promise<FileChange[]> {
  return invoke("wt_diff");
}

export async function wtPending(): Promise<FileChange[]> {
  return invoke("wt_pending");
}

export async function wtClear(): Promise<void> {
  return invoke("wt_clear");
}

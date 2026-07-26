import { invoke } from "@tauri-apps/api/core";

export type MemoryRecord = {
  id: string;
  content: string;
  tags: string;
  source: string;
  created_at: string;
};

export type SessionRecord = {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  model_id: string;
};

export async function searchMemories(
  query: string,
  limit?: number,
): Promise<MemoryRecord[]> {
  return invoke("memory_search", { query, limit: limit ?? 20 });
}

export async function addMemory(
  id: string,
  content: string,
  tags?: string,
  source?: string,
): Promise<void> {
  return invoke("memory_add", {
    id,
    content,
    tags: tags ?? "",
    source: source ?? "",
  });
}

export async function searchSessions(
  query: string,
  limit?: number,
): Promise<SessionRecord[]> {
  return invoke("memory_search_sessions", { query, limit: limit ?? 20 });
}

export async function saveSession(
  id: string,
  title: string,
  summary: string,
  modelId: string,
): Promise<void> {
  return invoke("memory_save_session", { id, title, summary, modelId });
}

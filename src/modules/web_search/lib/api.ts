import { invoke } from "@tauri-apps/api/core";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  relevance: number;
};

export type SearchBackend = "google" | "bing" | "duckduckgo" | "searxng" | "custom";

export async function wsSearch(query: string, backend?: SearchBackend, limit?: number): Promise<SearchResult[]> {
  return invoke("ws_search", { query, backend: backend ?? null, limit: limit ?? 10 });
}

export async function wsFetch(url: string): Promise<string> {
  return invoke("ws_fetch", { url });
}

export async function wsSetBackend(backend: SearchBackend): Promise<void> {
  return invoke("ws_set_backend", { backend });
}

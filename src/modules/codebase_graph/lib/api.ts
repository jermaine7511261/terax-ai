import { invoke } from "@tauri-apps/api/core";

export type SymbolEntry = {
  id: string;
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  parent: string | null;
  references: number;
};

export type FileGraph = {
  path: string;
  symbols: SymbolEntry[];
  imports: string[];
  dependents: string[];
};

export async function cgIndex(path?: string): Promise<void> {
  return invoke("cg_index", { path: path ?? null });
}

export async function cgRemove(file: string): Promise<void> {
  return invoke("cg_remove", { file });
}

export async function cgSearch(query: string): Promise<SymbolEntry[]> {
  return invoke("cg_search", { query });
}

export async function cgReferences(name: string): Promise<SymbolEntry[]> {
  return invoke("cg_references", { name });
}

export async function cgFile(file: string): Promise<FileGraph> {
  return invoke("cg_file", { file });
}

export async function cgAll(): Promise<SymbolEntry[]> {
  return invoke("cg_all");
}

export async function cgStats(): Promise<[number, number, number]> {
  return invoke("cg_stats");
}

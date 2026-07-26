import { create } from "zustand";
import type { SearchResult, SearchBackend } from "./api";

type WebSearchStore = {
  results: SearchResult[];
  backend: SearchBackend;
  isLoading: boolean;
  setResults: (r: SearchResult[]) => void;
  setBackend: (b: SearchBackend) => void;
  setIsLoading: (v: boolean) => void;
};

export const useWebSearchStore = create<WebSearchStore>((set) => ({
  results: [],
  backend: "google",
  isLoading: false,
  setResults: (r) => set({ results: r }),
  setBackend: (b) => set({ backend: b }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

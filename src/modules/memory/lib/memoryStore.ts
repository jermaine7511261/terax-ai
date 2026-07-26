import { create } from "zustand";
import type { MemoryRecord, SessionRecord } from "./memoryApi";

type MemoryStore = {
  searchQuery: string;
  searchResults: MemoryRecord[];
  sessionResults: SessionRecord[];
  isSearching: boolean;
  setSearchQuery: (q: string) => void;
  setSearchResults: (r: MemoryRecord[]) => void;
  setSessionResults: (r: SessionRecord[]) => void;
  setIsSearching: (v: boolean) => void;
};

export const useMemoryStore = create<MemoryStore>((set) => ({
  searchQuery: "",
  searchResults: [],
  sessionResults: [],
  isSearching: false,
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchResults: (r) => set({ searchResults: r }),
  setSessionResults: (r) => set({ sessionResults: r }),
  setIsSearching: (v) => set({ isSearching: v }),
}));

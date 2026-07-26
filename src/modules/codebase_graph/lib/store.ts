import { create } from "zustand";
import type { SymbolEntry, FileGraph } from "./api";

type CodebaseGraphStore = {
  symbols: SymbolEntry[];
  fileGraph: FileGraph | null;
  stats: [number, number, number] | null;
  isLoading: boolean;
  setSymbols: (s: SymbolEntry[]) => void;
  setFileGraph: (f: FileGraph | null) => void;
  setStats: (s: [number, number, number] | null) => void;
  setIsLoading: (v: boolean) => void;
};

export const useCodebaseGraphStore = create<CodebaseGraphStore>((set) => ({
  symbols: [],
  fileGraph: null,
  stats: null,
  isLoading: false,
  setSymbols: (s) => set({ symbols: s }),
  setFileGraph: (f) => set({ fileGraph: f }),
  setStats: (s) => set({ stats: s }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

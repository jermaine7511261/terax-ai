import { create } from "zustand";
import type { Hunk } from "./api";

type HunkerStore = {
  hunks: Hunk[];
  isLoading: boolean;
  setHunks: (h: Hunk[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useHunkerStore = create<HunkerStore>((set) => ({
  hunks: [],
  isLoading: false,
  setHunks: (h) => set({ hunks: h }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

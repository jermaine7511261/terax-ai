import { create } from "zustand";
import type { WorktreeSnapshot, FileChange } from "./api";

type WorktreeStore = {
  snapshot: WorktreeSnapshot | null;
  pending: FileChange[];
  isLoading: boolean;
  setSnapshot: (s: WorktreeSnapshot | null) => void;
  setPending: (p: FileChange[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useWorktreeStore = create<WorktreeStore>((set) => ({
  snapshot: null,
  pending: [],
  isLoading: false,
  setSnapshot: (s) => set({ snapshot: s }),
  setPending: (p) => set({ pending: p }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

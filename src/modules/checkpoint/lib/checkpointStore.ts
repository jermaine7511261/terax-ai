import { create } from "zustand";
import type { Checkpoint } from "./checkpointApi";

type CheckpointStore = {
  checkpoints: Checkpoint[];
  isLoading: boolean;
  setCheckpoints: (c: Checkpoint[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useCheckpointStore = create<CheckpointStore>((set) => ({
  checkpoints: [],
  isLoading: false,
  setCheckpoints: (c) => set({ checkpoints: c }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

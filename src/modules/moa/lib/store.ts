import { create } from "zustand";
import type { MoaModel, MoaPlan } from "./api";

type MoaStore = {
  models: MoaModel[];
  plan: MoaPlan | null;
  isLoading: boolean;
  setModels: (m: MoaModel[]) => void;
  setPlan: (p: MoaPlan | null) => void;
  setIsLoading: (v: boolean) => void;
};

export const useMoaStore = create<MoaStore>((set) => ({
  models: [],
  plan: null,
  isLoading: false,
  setModels: (m) => set({ models: m }),
  setPlan: (p) => set({ plan: p }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

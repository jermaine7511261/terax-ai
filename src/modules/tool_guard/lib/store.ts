import { create } from "zustand";
import type { GuardRule, GuardStats } from "./api";

type ToolGuardStore = {
  rules: GuardRule[];
  stats: GuardStats | null;
  isLoading: boolean;
  setRules: (r: GuardRule[]) => void;
  setStats: (s: GuardStats | null) => void;
  setIsLoading: (v: boolean) => void;
};

export const useToolGuardStore = create<ToolGuardStore>((set) => ({
  rules: [],
  stats: null,
  isLoading: false,
  setRules: (r) => set({ rules: r }),
  setStats: (s) => set({ stats: s }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

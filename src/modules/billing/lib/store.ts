import { create } from "zustand";
import type { UsageSummary, BudgetConfig, UsageRecord } from "./api";

type BillingStore = {
  summary: UsageSummary | null;
  budget: BudgetConfig | null;
  recent: UsageRecord[];
  isLoading: boolean;
  setSummary: (s: UsageSummary | null) => void;
  setBudget: (b: BudgetConfig | null) => void;
  setRecent: (r: UsageRecord[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useBillingStore = create<BillingStore>((set) => ({
  summary: null,
  budget: null,
  recent: [],
  isLoading: false,
  setSummary: (s) => set({ summary: s }),
  setBudget: (b) => set({ budget: b }),
  setRecent: (r) => set({ recent: r }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

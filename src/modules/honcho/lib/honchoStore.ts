import { create } from "zustand";
import type { HonchoInsight } from "./honchoApi";
import * as api from "./honchoApi";

type HonchoState = {
  insights: HonchoInsight[];
  loading: boolean;
  loadInsights: () => Promise<void>;
};

export const useHonchoStore = create<HonchoState>((set) => ({
  insights: [],
  loading: false,
  loadInsights: async () => {
    set({ loading: true });
    try { set({ insights: await api.getInsights(), loading: false }); }
    catch { set({ loading: false }); }
  },
}));

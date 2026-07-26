import { create } from "zustand";
import type { CircuitBreaker } from "./api";

type CircuitStore = {
  breakers: CircuitBreaker[];
  isLoading: boolean;
  setBreakers: (b: CircuitBreaker[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useCircuitStore = create<CircuitStore>((set) => ({
  breakers: [],
  isLoading: false,
  setBreakers: (b) => set({ breakers: b }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

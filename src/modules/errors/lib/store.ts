import { create } from "zustand";
import type { ClassifiedError, ErrorStats } from "./api";

type ErrorsStore = {
  errors: ClassifiedError[];
  stats: ErrorStats | null;
  isLoading: boolean;
  setErrors: (e: ClassifiedError[]) => void;
  setStats: (s: ErrorStats | null) => void;
  setIsLoading: (v: boolean) => void;
};

export const useErrorsStore = create<ErrorsStore>((set) => ({
  errors: [],
  stats: null,
  isLoading: false,
  setErrors: (e) => set({ errors: e }),
  setStats: (s) => set({ stats: s }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

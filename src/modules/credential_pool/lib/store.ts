import { create } from "zustand";
import type { CredentialSource } from "./api";

type CredentialPoolStore = {
  sources: CredentialSource[];
  isLoading: boolean;
  setSources: (s: CredentialSource[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useCredentialPoolStore = create<CredentialPoolStore>((set) => ({
  sources: [],
  isLoading: false,
  setSources: (s) => set({ sources: s }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

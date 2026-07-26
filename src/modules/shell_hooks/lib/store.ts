import { create } from "zustand";
import type { ShellHook } from "./api";

type ShellHooksStore = {
  hooks: ShellHook[];
  isLoading: boolean;
  setHooks: (h: ShellHook[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useShellHooksStore = create<ShellHooksStore>((set) => ({
  hooks: [],
  isLoading: false,
  setHooks: (h) => set({ hooks: h }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

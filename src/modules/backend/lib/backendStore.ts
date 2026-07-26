import { create } from "zustand";
import type { BackendConfig, BackendStatus } from "./backendApi";

type BackendStore = {
  backends: BackendConfig[];
  statuses: BackendStatus[];
  activeBackendId: string;
  isLoading: boolean;
  setBackends: (b: BackendConfig[]) => void;
  setStatuses: (s: BackendStatus[]) => void;
  setActiveBackendId: (id: string) => void;
  setIsLoading: (v: boolean) => void;
};

export const useBackendStore = create<BackendStore>((set) => ({
  backends: [],
  statuses: [],
  activeBackendId: "local",
  isLoading: false,
  setBackends: (b) => set({ backends: b }),
  setStatuses: (s) => set({ statuses: s }),
  setActiveBackendId: (id) => set({ activeBackendId: id }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

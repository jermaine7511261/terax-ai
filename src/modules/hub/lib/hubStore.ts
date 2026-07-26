import { create } from "zustand";
import type { HubSkill, InstalledSkill } from "./hubApi";

type Tab = "browse" | "installed";

type HubStore = {
  tab: Tab;
  query: string;
  searchResults: HubSkill[];
  installed: InstalledSkill[];
  isLoading: boolean;
  setTab: (t: Tab) => void;
  setQuery: (q: string) => void;
  setSearchResults: (r: HubSkill[]) => void;
  setInstalled: (i: InstalledSkill[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const useHubStore = create<HubStore>((set) => ({
  tab: "browse",
  query: "",
  searchResults: [],
  installed: [],
  isLoading: false,
  setTab: (t) => set({ tab: t }),
  setQuery: (q) => set({ query: q }),
  setSearchResults: (r) => set({ searchResults: r }),
  setInstalled: (i) => set({ installed: i }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

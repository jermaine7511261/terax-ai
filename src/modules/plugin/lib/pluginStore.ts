import { create } from "zustand";
import type { PluginInstance, PluginToolDef } from "./pluginApi";

type PluginStore = {
  plugins: PluginInstance[];
  tools: PluginToolDef[];
  isLoading: boolean;
  setPlugins: (p: PluginInstance[]) => void;
  setTools: (t: PluginToolDef[]) => void;
  setIsLoading: (v: boolean) => void;
};

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: [],
  tools: [],
  isLoading: false,
  setPlugins: (p) => set({ plugins: p }),
  setTools: (t) => set({ tools: t }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

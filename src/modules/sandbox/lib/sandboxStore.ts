import { create } from "zustand";
import type { SandboxConfig, SandboxLevel } from "./sandboxApi";

type SandboxStore = {
  config: SandboxConfig;
  setConfig: (c: SandboxConfig) => void;
  setLevel: (l: SandboxLevel) => void;
};

export const useSandboxStore = create<SandboxStore>((set) => ({
  config: {
    level: "Off",
    workspace_dir: null,
    allow_network: true,
    allow_write: true,
  },
  setConfig: (c) => set({ config: c }),
  setLevel: (l) => set((s) => ({ config: { ...s.config, level: l } })),
}));

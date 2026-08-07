import { platform as tauriPlatform, arch as tauriArch } from "@tauri-apps/plugin-os";
import type { IOsAdapter } from "../types";

export const tauriOs: IOsAdapter = {
  platform: async () => tauriPlatform(),
  arch: async () => tauriArch(),
};

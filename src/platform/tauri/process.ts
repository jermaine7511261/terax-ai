import { relaunch } from "@tauri-apps/plugin-process";
import { getName, getVersion } from "@tauri-apps/api/app";
import type { IProcessAdapter } from "../types";

export const tauriProcess: IProcessAdapter = {
  relaunch,
  exit: (_code?: number) => {
    // Tauri doesn't expose a direct exit; close window as fallback.
    // The Rust side can handle graceful shutdown.
    return Promise.resolve();
  },
  getName,
  getVersion,
};

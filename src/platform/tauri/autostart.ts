import {
  enable,
  disable,
  isEnabled,
} from "@tauri-apps/plugin-autostart";
import type { IAutostartAdapter } from "../types";

export const tauriAutostart: IAutostartAdapter = {
  enable,
  disable,
  isEnabled,
};

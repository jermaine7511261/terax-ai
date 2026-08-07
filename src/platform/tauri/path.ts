import { homeDir, join, appConfigDir } from "@tauri-apps/api/path";
import type { IPathAdapter } from "../types";

export const tauriPath: IPathAdapter = {
  homeDir,
  join,
  appConfigDir,
};

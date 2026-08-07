import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { revealItemInDir as tauriRevealItemInDir } from "@tauri-apps/plugin-opener";
import type { IOpenerAdapter } from "../types";

export const tauriOpener: IOpenerAdapter = {
  openUrl: tauriOpenUrl,
  revealItemInDir: tauriRevealItemInDir,
};

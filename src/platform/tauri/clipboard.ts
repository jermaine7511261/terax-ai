import {
  readText as tauriReadText,
  writeText as tauriWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import type { IClipboardAdapter } from "../types";

export const tauriClipboard: IClipboardAdapter = {
  readText: tauriReadText,
  writeText: tauriWriteText,
};

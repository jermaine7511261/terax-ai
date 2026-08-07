import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import type { IDialogAdapter } from "../types";

export const tauriDialog: IDialogAdapter = {
  open(options) {
    return tauriOpenDialog({
      title: options?.title,
      defaultPath: options?.defaultPath,
      directory: options?.directory,
      multiple: options?.multiple,
      filters: options?.filters,
    }) as Promise<string | string[] | null>;
  },
};

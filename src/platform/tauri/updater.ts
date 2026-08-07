import { check } from "@tauri-apps/plugin-updater";
import type { IUpdaterAdapter } from "../types";

export const tauriUpdater: IUpdaterAdapter = {
  async check() {
    const result = await check();
    if (!result) return { available: false };
    return {
      available: true,
      update: {
        version: result.version,
        date: result.date ?? undefined,
        body: result.body ?? undefined,
      },
    };
  },
};

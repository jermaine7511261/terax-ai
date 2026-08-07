import {
  sendNotification as tauriSendNotification,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type { INotificationAdapter } from "../types";

export const tauriNotification: INotificationAdapter = {
  sendNotification: tauriSendNotification,
  isPermissionGranted,
  requestPermission: async () => {
    const result = await requestPermission();
    return result === "granted";
  },
};

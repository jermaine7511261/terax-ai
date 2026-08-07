/**
 * No-op stubs for features not available in the browser.
 * Used by the web adapter for capabilities that have no web equivalent.
 */
import type {
  IDialogAdapter,
  IOpenerAdapter,
  INotificationAdapter,
  IAutostartAdapter,
  IProcessAdapter,
  IUpdaterAdapter,
  IWebviewAdapter,
  IWatchAdapter,
} from "../types";

export const noopAdapter = {
  webview: {
    getCurrentWebviewWindow(_label: string) {
      return null;
    },
    getCurrentWebview() {
      return null;
    },
  } as IWebviewAdapter,

  dialog: {
    async open() {
      console.warn("[web] Dialog not available in browser");
      return null;
    },
  } as IDialogAdapter,

  opener: {
    async openUrl(url: string) {
      window.open(url, "_blank");
    },
    async revealItemInDir(_path: string) {
      console.warn("[web] revealItemInDir not available in browser");
    },
  } as IOpenerAdapter,

  notification: {
    sendNotification(options: { title: string; body?: string }) {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(options.title, { body: options.body });
      }
    },
    async isPermissionGranted() {
      return "Notification" in window && Notification.permission === "granted";
    },
    async requestPermission() {
      if (!("Notification" in window)) return false;
      const result = await Notification.requestPermission();
      return result === "granted";
    },
  } as INotificationAdapter,

  autostart: {
    async enable() {},
    async disable() {},
    async isEnabled() {
      return false;
    },
  } as IAutostartAdapter,

  process: {
    async relaunch() {
      location.reload();
    },
    async exit() {
      window.close();
    },
    async getName() {
      return "yamet-web";
    },
    async getVersion() {
      return "0.0.0-web";
    },
  } as IProcessAdapter,

  updater: {
    async check() {
      return { available: false };
    },
  } as IUpdaterAdapter,

  watch: {
    async watch() {
      console.warn("[web] File watch not available in browser");
      return 0;
    },
    async unwatch() {},
  } as IWatchAdapter,
};

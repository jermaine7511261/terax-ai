import {
  emit as tauriEmit,
  listen as tauriListen,
  type UnlistenFn as TauriUnlistenFn,
} from "@tauri-apps/api/event";
import type { IEventAdapter } from "../types";

export const tauriEvents: IEventAdapter = {
  listen<T = unknown>(
    event: string,
    handler: (payload: { payload: T }) => void,
  ) {
    return tauriListen<T>(event, handler).then(
      (unlisten: TauriUnlistenFn) => unlisten,
    );
  },

  emit(event: string, payload: unknown) {
    return tauriEmit(event, payload);
  },
};

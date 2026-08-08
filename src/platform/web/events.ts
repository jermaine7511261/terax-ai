import type { IEventAdapter, UnlistenFn } from "../types";

/**
 * Browser event bus using CustomEvent.
 * Same-tab only; cross-tab needs BroadcastChannel (Phase 2).
 */
const listeners = new Map<
  string,
  Set<(payload: { payload: unknown }) => void>
>();

export const webEvents: IEventAdapter = {
  async listen<T = unknown>(
    event: string,
    handler: (payload: { payload: T }) => void,
  ): Promise<UnlistenFn> {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());

      // Bridge CustomEvent → listener set
      const bridge = (e: Event) => {
        const ce = e as CustomEvent;
        for (const cb of listeners.get(event) ?? []) {
          cb({ payload: ce.detail });
        }
      };
      window.addEventListener(`yamet:${event}`, bridge);
    }
    const set = listeners.get(event);
    if (set) {
      set.add(handler as unknown as (payload: { payload: unknown }) => void);
    }

    return () => {
      listeners
        .get(event)
        ?.delete(handler as unknown as (payload: { payload: unknown }) => void);
    };
  },

  async emit(event: string, payload: unknown): Promise<void> {
    window.dispatchEvent(new CustomEvent(`yamet:${event}`, { detail: payload }));
  },
};

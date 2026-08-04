import { create } from "zustand";
import {
  schedulerDelete,
  schedulerList,
  schedulerToggle,
  schedulerUpsert,
  type ScheduledTask,
} from "../lib/scheduler";

type SchedulerStoreState = {
  hydrated: boolean;
  tasks: ScheduledTask[];
  hydrate: () => Promise<void>;
  upsert: (task: ScheduledTask) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
};

export const useSchedulerStore = create<SchedulerStoreState>((set, get) => ({
  hydrated: false,
  tasks: [],

  hydrate: async () => {
    if (get().hydrated) return;
    set({ tasks: await schedulerList().catch(() => []), hydrated: true });
  },

  upsert: async (task) => {
    await schedulerUpsert(task);
    set({ tasks: await schedulerList() });
  },

  remove: async (id) => {
    await schedulerDelete(id);
    set({ tasks: await schedulerList() });
  },

  toggle: async (id, enabled) => {
    await schedulerToggle(id, enabled);
    set({ tasks: await schedulerList() });
  },
}));

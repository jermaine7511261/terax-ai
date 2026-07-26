import { create } from "zustand";
import type { CronJob, CronRunLog } from "./cronApi";
import * as api from "./cronApi";

type CronState = {
  jobs: CronJob[];
  logs: CronRunLog[];
  loading: boolean;
  selectedJob: string | null;
  loadJobs: () => Promise<void>;
  loadLogs: (jobId?: string) => Promise<void>;
  addJob: (name: string, command: string, schedule: string, backendId: string, workDir?: string) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  selectJob: (id: string | null) => void;
};

export const useCronStore = create<CronState>((set, get) => ({
  jobs: [],
  logs: [],
  loading: false,
  selectedJob: null,
  loadJobs: async () => {
    set({ loading: true });
    try {
      const jobs = await api.listJobs();
      set({ jobs, loading: false });
    } catch { set({ loading: false }); }
  },
  loadLogs: async (jobId?: string) => {
    try {
      const logs = await api.getLogs(jobId);
      set({ logs });
    } catch {}
  },
  addJob: async (name, command, schedule, backendId, workDir) => {
    await api.addJob(name, command, schedule, backendId, workDir);
    await get().loadJobs();
  },
  deleteJob: async (id) => {
    await api.deleteJob(id);
    await get().loadJobs();
  },
  toggleJob: async (id, enabled) => {
    await api.updateJob(id, undefined, undefined, undefined, enabled);
    await get().loadJobs();
  },
  selectJob: (id) => set({ selectedJob: id }),
}));

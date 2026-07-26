import { create } from "zustand";
import type { MemorySnapshot } from "./snapshotApi";
import * as api from "./snapshotApi";

type SnapshotState = {
  snapshots: MemorySnapshot[];
  loading: boolean;
  loadSnapshots: () => Promise<void>;
  createSnapshot: (label: string, memCount: number, sessCount: number, skillCount: number) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
};

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  loading: false,
  loadSnapshots: async () => {
    set({ loading: true });
    try { set({ snapshots: await api.listSnapshots(), loading: false }); }
    catch { set({ loading: false }); }
  },
  createSnapshot: async (label, memCount, sessCount, skillCount) => {
    await api.createSnapshot(label, memCount, sessCount, skillCount);
    await get().loadSnapshots();
  },
  deleteSnapshot: async (id) => {
    await api.deleteSnapshot(id);
    await get().loadSnapshots();
  },
}));

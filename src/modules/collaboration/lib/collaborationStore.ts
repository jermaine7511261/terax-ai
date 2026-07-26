import { create } from "zustand";

export type ShareSession = {
  id: string;
  title: string;
  createdAt: string;
  shareUrl?: string;
};

type CollaborationStore = {
  sharedSessions: ShareSession[];
  isSharing: boolean;
  setSharedSessions: (s: ShareSession[]) => void;
  setIsSharing: (v: boolean) => void;
  addSharedSession: (s: ShareSession) => void;
};

export const useCollaborationStore = create<CollaborationStore>((set) => ({
  sharedSessions: [],
  isSharing: false,
  setSharedSessions: (s) => set({ sharedSessions: s }),
  setIsSharing: (v) => set({ isSharing: v }),
  addSharedSession: (s) =>
    set((state) => ({ sharedSessions: [...state.sharedSessions, s] })),
}));

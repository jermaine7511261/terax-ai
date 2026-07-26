import { create } from "zustand";
import type { AgentSession } from "./sessionApi";

type SessionStore = {
  sessions: AgentSession[];
  activeId: string | null;
  isLoading: boolean;
  setSessions: (s: AgentSession[]) => void;
  setActiveId: (id: string | null) => void;
  setIsLoading: (v: boolean) => void;
  updateInList: (s: AgentSession) => void;
  removeFromList: (id: string) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeId: null,
  isLoading: false,
  setSessions: (s) => set({ sessions: s }),
  setActiveId: (id) => set({ activeId: id }),
  setIsLoading: (v) => set({ isLoading: v }),
  updateInList: (updated) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === updated.id ? updated : s,
      ),
    })),
  removeFromList: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),
}));

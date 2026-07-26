import { create } from "zustand";
import type { UserProfile } from "./profileApi";
import * as api from "./profileApi";

type ProfileState = {
  profile: UserProfile | null;
  loading: boolean;
  loadProfile: () => Promise<void>;
  updateProfile: (p: UserProfile) => Promise<void>;
  recordGoal: (goal: string) => Promise<void>;
};

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  loading: false,
  loadProfile: async () => {
    set({ loading: true });
    try { set({ profile: await api.getProfile(), loading: false }); }
    catch { set({ loading: false }); }
  },
  updateProfile: async (profile) => {
    await api.saveProfile(profile);
    set({ profile });
  },
  recordGoal: async (goal) => {
    await api.recordGoal(goal);
    await get().loadProfile();
  },
}));

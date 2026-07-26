import { create } from "zustand";
import type { SkillDef } from "./skillsApi";

type SkillsStore = {
  skills: SkillDef[];
  selectedSkill: SkillDef | null;
  isLoading: boolean;
  filter: string;
  setSkills: (s: SkillDef[]) => void;
  setSelectedSkill: (s: SkillDef | null) => void;
  setIsLoading: (v: boolean) => void;
  setFilter: (f: string) => void;
};

export const useSkillsStore = create<SkillsStore>((set) => ({
  skills: [],
  selectedSkill: null,
  isLoading: false,
  filter: "",
  setSkills: (s) => set({ skills: s }),
  setSelectedSkill: (s) => set({ selectedSkill: s }),
  setIsLoading: (v) => set({ isLoading: v }),
  setFilter: (f) => set({ filter: f }),
}));

import { create } from "zustand";
import type { TtsBackend, TtsVoice, TtsResult } from "./api";

type TtsStore = {
  backend: TtsBackend | null;
  voices: TtsVoice[];
  lastResult: TtsResult | null;
  isLoading: boolean;
  setBackend: (b: TtsBackend | null) => void;
  setVoices: (v: TtsVoice[]) => void;
  setLastResult: (r: TtsResult | null) => void;
  setIsLoading: (v: boolean) => void;
};

export const useTtsStore = create<TtsStore>((set) => ({
  backend: null,
  voices: [],
  lastResult: null,
  isLoading: false,
  setBackend: (b) => set({ backend: b }),
  setVoices: (v) => set({ voices: v }),
  setLastResult: (r) => set({ lastResult: r }),
  setIsLoading: (v) => set({ isLoading: v }),
}));

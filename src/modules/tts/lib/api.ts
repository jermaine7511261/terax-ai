import { invoke } from "@tauri-apps/api/core";

export type TtsBackend = {
  id: string;
  name: string;
  voices: number;
  enabled: boolean;
};

export type TtsResult = {
  success: boolean;
  duration_ms: number;
  char_count: number;
  error: string | null;
  audio_base64: string | null;
};

export type TtsVoice = {
  id: string;
  name: string;
  language: string;
  gender: string | null;
};

export async function ttsSpeak(text: string, voiceId?: string): Promise<TtsResult> {
  return invoke("tts_speak", { text, voiceId: voiceId ?? null });
}

export async function ttsSetBackend(backendId: string): Promise<void> {
  return invoke("tts_set_backend", { backendId });
}

export async function ttsGetBackend(): Promise<TtsBackend | null> {
  return invoke("tts_get_backend");
}

export async function ttsVoices(): Promise<TtsVoice[]> {
  return invoke("tts_voices");
}

export async function ttsClearCache(): Promise<void> {
  return invoke("tts_clear_cache");
}

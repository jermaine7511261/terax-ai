import { invoke } from "@tauri-apps/api/core";

export type TtsBackend = "WebSpeech" | "Edge" | "Say" | "ESpeak" | "HttpApi";
export type TtsResult = {
  success: boolean;
  duration_ms: number;
  char_count: number;
  error: string | null;
  audio_base64: string | null;
};

/**
 * Speak text using the configured TTS engine.
 * Falls back to Web Speech API in browser/Tauri webview.
 */
export async function speak(
  text: string,
  voice?: string,
  speed?: number,
): Promise<TtsResult> {
  try {
    return await invoke("tts_speak", {
      text,
      voice: voice ?? null,
      speed: speed ?? null,
    });
  } catch {
    // Fallback to Web Speech API
    return webSpeechSpeak(text, voice, speed);
  }
}

export async function setTtsBackend(backend: TtsBackend): Promise<void> {
  try {
    await invoke("tts_set_backend", { backend });
  } catch {}
}

export async function getTtsBackend(): Promise<TtsBackend> {
  try {
    return await invoke("tts_get_backend");
  } catch {
    return "WebSpeech";
  }
}

export async function listVoices(): Promise<string[]> {
  try {
    return await invoke("tts_voices");
  } catch {
    return ["default"];
  }
}

/**
 * Browser-native TTS using Web Speech API.
 */
function webSpeechSpeak(
  text: string,
  voice?: string,
  speed?: number,
): Promise<TtsResult> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve({ success: false, duration_ms: 0, char_count: text.length, error: "Web Speech API not available", audio_base64: null });
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) {
      const voices = window.speechSynthesis.getVoices();
      const found = voices.find((v) => v.name.includes(voice) || v.name === voice);
      if (found) utterance.voice = found;
    }
    if (speed) utterance.rate = speed;

    const start = Date.now();
    utterance.onend = () => {
      resolve({ success: true, duration_ms: Date.now() - start, char_count: text.length, error: null, audio_base64: null });
    };
    utterance.onerror = (e) => {
      resolve({ success: false, duration_ms: Date.now() - start, char_count: text.length, error: e.error, audio_base64: null });
    };

    window.speechSynthesis.speak(utterance);
  });
}

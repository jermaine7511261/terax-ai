use std::sync::Mutex;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TtsBackend {
    /// Web Speech API (browser native, no dep)
    WebSpeech,
    /// Edge TTS (free, works on Windows)
    Edge,
    /// macOS Say command
    Say,
    /// eSpeak (cross-platform, offline)
    ESpeak,
    /// HTTP TTS API (e.g. OpenAI TTS)
    HttpApi,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct TtsRequest {
    pub text: String,
    pub voice: Option<String>,
    pub speed: Option<f64>,
    pub backend: TtsBackend,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct TtsResult {
    pub success: bool,
    pub duration_ms: u64,
    pub char_count: usize,
    pub error: Option<String>,
    pub audio_base64: Option<String>,
}

pub struct TtsEngine {
    backend: Mutex<TtsBackend>,
    cache: Mutex<HashMap<String, String>>,
}

impl Default for TtsEngine {
    fn default() -> Self {
        Self {
            backend: Mutex::new(TtsBackend::WebSpeech),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl TtsEngine {
    pub fn new() -> Self { Self::default() }

    pub fn set_backend(&self, backend: TtsBackend) {
        *self.backend.lock().unwrap() = backend;
    }

    pub fn get_backend(&self) -> Result<TtsBackend, String> {
        self.backend.lock().map_err(|e| e.to_string()).map(|guard| *guard)
    }

    /// Synthesize text to speech.
    /// Returns base64-encoded audio data (when supported) or play status.
    pub fn speak(&self, text: &str, voice: Option<&str>, speed: Option<f64>) -> Result<TtsResult, String> {
        let backend = self.backend.lock().map_err(|e| e.to_string())?;
        let char_count = text.len();

        // Check cache
        let cache_key = format!("{}-{}-{:?}-{}", text, voice.unwrap_or("default"), backend, speed.unwrap_or(1.0));
        {
            let cache = self.cache.lock().map_err(|e| e.to_string())?;
            if let Some(cached) = cache.get(&cache_key) {
                return Ok(TtsResult {
                    success: true,
                    duration_ms: 0,
                    char_count,
                    error: None,
                    audio_base64: Some(cached.clone()),
                });
            }
        }

        let start = std::time::Instant::now();

        match *backend {
            TtsBackend::WebSpeech => {
                // Web Speech API is handled in the browser via JS.
                // Rust side just validates and returns.
                Ok(TtsResult {
                    success: true,
                    duration_ms: start.elapsed().as_millis() as u64,
                    char_count,
                    error: None,
                    audio_base64: None,
                })
            }
            TtsBackend::Edge => {
                // Edge TTS via HTTP (edge-tts CLI or equivalent)
                #[cfg(target_os = "windows")]
                {
                    let _voice_arg = voice.unwrap_or("en-US-JennyNeural");
                    let speed_arg = speed.unwrap_or(1.0);
                    let result = std::process::Command::new("powershell")
                        .args(["-Command", &format!(
                            "Add-Type -AssemblyName System.Speech; \
                             $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
                             $s.Rate = {}; \
                             $s.Speak('{}'); \
                             Write-Output 'OK'",
                            ((speed_arg - 1.0) * 10.0) as i32,
                            text.replace('\'', "''")
                        )])
                        .output();
                    match result {
                        Ok(out) => Ok(TtsResult {
                            success: out.status.success(),
                            duration_ms: start.elapsed().as_millis() as u64,
                            char_count,
                            error: if out.status.success() { None } else {
                                Some(String::from_utf8_lossy(&out.stderr).to_string())
                            },
                            audio_base64: None,
                        }),
                        Err(e) => Ok(TtsResult {
                            success: false,
                            duration_ms: start.elapsed().as_millis() as u64,
                            char_count,
                            error: Some(format!("Edge TTS failed: {e}")),
                            audio_base64: None,
                        }),
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Ok(TtsResult {
                        success: false, duration_ms: 0, char_count,
                        error: Some("Edge TTS requires Windows".into()),
                        audio_base64: None,
                    })
                }
            }
            TtsBackend::Say => {
                #[cfg(target_os = "macos")]
                {
                    let voice_arg = voice.unwrap_or("Alex");
                    let result = std::process::Command::new("say")
                        .args(["-v", voice_arg, text])
                        .output();
                    match result {
                        Ok(_) => Ok(TtsResult {
                            success: true,
                            duration_ms: start.elapsed().as_millis() as u64,
                            char_count,
                            error: None, audio_base64: None,
                        }),
                        Err(e) => Ok(TtsResult {
                            success: false, duration_ms: 0, char_count,
                            error: Some(format!("say failed: {e}")),
                            audio_base64: None,
                        }),
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    Ok(TtsResult {
                        success: false, duration_ms: 0, char_count,
                        error: Some("say command requires macOS".into()),
                        audio_base64: None,
                    })
                }
            }
            TtsBackend::ESpeak => {
                // eSpeak (cross-platform, offline)
                let result = std::process::Command::new("espeak")
                    .args([text])
                    .output();
                match result {
                    Ok(_) => Ok(TtsResult {
                        success: true,
                        duration_ms: start.elapsed().as_millis() as u64,
                        char_count,
                        error: None, audio_base64: None,
                    }),
                    Err(e) => Ok(TtsResult {
                        success: false, duration_ms: 0, char_count,
                        error: Some(format!("espeak failed: {e}. Install: apt install espeak / brew install espeak")),
                        audio_base64: None,
                    }),
                }
            }
            TtsBackend::HttpApi => {
                Ok(TtsResult {
                    success: false, duration_ms: 0, char_count,
                    error: Some("HTTP TTS API not configured. Use Settings → Voice to set up.".into()),
                    audio_base64: None,
                })
            }
        }
    }

    pub fn list_voices(&self) -> Vec<String> {
        match *self.backend.lock().unwrap() {
            TtsBackend::WebSpeech => vec!["default".into()],
            TtsBackend::Edge => vec![
                "en-US-JennyNeural".into(), "en-US-GuyNeural".into(),
                "zh-CN-XiaoxiaoNeural".into(), "ja-JP-NanamiNeural".into(),
            ],
            TtsBackend::Say => vec!["Alex".into(), "Samantha".into(), "Tom".into()],
            TtsBackend::ESpeak => vec!["default".into(), "en+f1".into(), "en+m1".into()],
            TtsBackend::HttpApi => vec!["alloy".into(), "echo".into(), "fable".into(), "onyx".into(), "nova".into(), "shimmer".into()],
        }
    }

    /// Clear spoken text cache.
    pub fn clear_cache(&self) -> Result<(), String> {
        self.cache.lock().map_err(|e| e.to_string())?.clear();
        Ok(())
    }
}

#[tauri::command]
pub fn tts_speak(engine: tauri::State<'_, TtsEngine>, text: String, voice: Option<String>, speed: Option<f64>) -> Result<TtsResult, String> {
    engine.speak(&text, voice.as_deref(), speed)
}

#[tauri::command]
pub fn tts_set_backend(engine: tauri::State<'_, TtsEngine>, backend: TtsBackend) -> Result<(), String> {
    engine.set_backend(backend);
    Ok(())
}

#[tauri::command]
pub fn tts_get_backend(engine: tauri::State<'_, TtsEngine>) -> Result<TtsBackend, String> {
    engine.get_backend()
}

#[tauri::command]
pub fn tts_voices(engine: tauri::State<'_, TtsEngine>) -> Result<Vec<String>, String> {
    Ok(engine.list_voices())
}

#[tauri::command]
pub fn tts_clear_cache(engine: tauri::State<'_, TtsEngine>) -> Result<(), String> {
    engine.clear_cache()
}

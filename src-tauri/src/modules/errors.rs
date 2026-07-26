use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ErrorCategory {
    /// Network/connectivity issues.
    Network,
    /// API authentication/authorization.
    Auth,
    /// Rate limiting / quota exceeded.
    RateLimit,
    /// Model context window exceeded.
    ContextWindow,
    /// Invalid model name or configuration.
    ModelConfig,
    /// Tool execution error (file not found, permission, etc.).
    ToolExecution,
    /// Provider returned an error.
    Provider,
    /// Invalid user input.
    UserInput,
    /// Internal agent logic error.
    AgentLogic,
    /// Timeout.
    Timeout,
    /// Unknown/unclassified.
    Unknown,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ClassifiedError {
    pub id: String,
    pub timestamp: String,
    pub category: ErrorCategory,
    pub raw_message: String,
    pub source: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub tool: Option<String>,
    pub recovered: bool,
    pub recovery_action: Option<String>,
    pub frequency: u32,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ErrorPattern {
    pub id: String,
    pub pattern: String,
    pub category: ErrorCategory,
    pub label: String,
    pub severity: u8,
    pub suggested_fix: Option<String>,
}

pub struct ErrorClassifier {
    patterns: Mutex<Vec<ErrorPattern>>,
    classified: Mutex<Vec<ClassifiedError>>,
    freq_map: Mutex<HashMap<String, u32>>,
}

impl Default for ErrorClassifier {
    fn default() -> Self {
        let patterns = vec![
            ErrorPattern {
                id: "pat-timeout".into(),
                pattern: "timeout|timed out|time out|deadline exceeded|too long".into(),
                category: ErrorCategory::Timeout,
                label: "Request timed out".into(),
                severity: 7,
                suggested_fix: Some("Retry with a simpler query or switch to a faster model".into()),
            },
            ErrorPattern {
                id: "pat-rate-limit".into(),
                pattern: "rate limit|too many requests|429|quota exceeded|exceeded your|limit reached|throttled".into(),
                category: ErrorCategory::RateLimit,
                label: "Rate limited".into(),
                severity: 6,
                suggested_fix: Some("Wait before retrying or upgrade your API plan".into()),
            },
            ErrorPattern {
                id: "pat-auth".into(),
                pattern: "unauthorized|401|403|invalid api key|authentication failed|permission denied|not authorized|invalid key|api key required".into(),
                category: ErrorCategory::Auth,
                label: "Authentication failed".into(),
                severity: 9,
                suggested_fix: Some("Check your API key in Settings → AI Providers".into()),
            },
            ErrorPattern {
                id: "pat-context".into(),
                pattern: "context length|maximum context|token limit|too many tokens|context window|reduce the length|input too long|max_tokens".into(),
                category: ErrorCategory::ContextWindow,
                label: "Context window exceeded".into(),
                severity: 5,
                suggested_fix: Some("The conversation is too long. Start a new session or switch to a model with larger context".into()),
            },
            ErrorPattern {
                id: "pat-model".into(),
                pattern: "model not found|unknown model|does not exist|not a valid model|unavailable model|model.*not supported".into(),
                category: ErrorCategory::ModelConfig,
                label: "Invalid model".into(),
                severity: 8,
                suggested_fix: Some("Check the model name in Settings → Models".into()),
            },
            ErrorPattern {
                id: "pat-network".into(),
                pattern: "econnrefused|econnreset|ehostunreach|enetunreach|dns|name or service not known|no route to host|connection refused|connection reset|network error|fetch failed|request failed".into(),
                category: ErrorCategory::Network,
                label: "Network error".into(),
                severity: 6,
                suggested_fix: Some("Check your internet connection and firewall settings".into()),
            },
            ErrorPattern {
                id: "pat-tool-notfound".into(),
                pattern: "no such file|not found|enoent|eacces|permission denied|cannot find|does not exist".into(),
                category: ErrorCategory::ToolExecution,
                label: "File/resource not found".into(),
                severity: 5,
                suggested_fix: Some("Verify the file path and try again".into()),
            },
            ErrorPattern {
                id: "pat-provider".into(),
                pattern: "500|502|503|504|internal server error|service unavailable|bad gateway|provider error|upstream".into(),
                category: ErrorCategory::Provider,
                label: "Provider error".into(),
                severity: 4,
                suggested_fix: Some("The AI provider is experiencing issues. Retry or switch providers".into()),
            },
            ErrorPattern {
                id: "pat-invalid-json".into(),
                pattern: "invalid json|parse error|unexpected token|malformed|syntax error".into(),
                category: ErrorCategory::AgentLogic,
                label: "JSON parse error".into(),
                severity: 6,
                suggested_fix: Some("This is an internal error. The agent will retry automatically".into()),
            },
            ErrorPattern {
                id: "pat-input-empty".into(),
                pattern: "empty|no input|nothing to|please provide|missing required".into(),
                category: ErrorCategory::UserInput,
                label: "Missing input".into(),
                severity: 3,
                suggested_fix: Some("Provide the required information".into()),
            },
        ];
        Self {
            patterns: Mutex::new(patterns),
            classified: Mutex::new(Vec::new()),
            freq_map: Mutex::new(HashMap::new()),
        }
    }
}

impl ErrorClassifier {
    pub fn new() -> Self { Self::default() }

    pub fn classify(&self, message: &str, source: &str, provider: Option<&str>, model: Option<&str>, tool: Option<&str>) -> Result<ClassifiedError, String> {
        let lowercase = message.to_lowercase();
        let patterns = self.patterns.lock().map_err(|e| e.to_string())?;

        let mut best: Option<(usize, &ErrorPattern)> = None;
        for (i, p) in patterns.iter().enumerate() {
            let re_pattern = p.pattern.replace('|', "|");
            // Simple substring-based matching for each alternative
            for alt in re_pattern.split('|') {
                if lowercase.contains(alt.trim()) {
                    if best.as_ref().map_or(true, |(_, b)| p.severity > b.severity) {
                        best = Some((i, p));
                    }
                    break;
                }
            }
        }

        let (category, _label, _severity, suggested_fix) = match best {
            Some((_, p)) => (p.category.clone(), p.label.clone(), p.severity, p.suggested_fix.clone()),
            None => (ErrorCategory::Unknown, "Unclassified error".into(), 1, None),
        };

        let now = chrono_now();
        let mut freq = self.freq_map.lock().map_err(|e| e.to_string())?;
        let key = format!("{}-{}-{}", source, tool.unwrap_or(""), message.len());
        *freq.entry(key.clone()).or_insert(0) += 1;
        let frequency = freq[&key];
        drop(freq);

        let classified = ClassifiedError {
            id: format!("err-{now}"),
            timestamp: now,
            category,
            raw_message: message.into(),
            source: source.into(),
            provider: provider.map(|s| s.into()),
            model: model.map(|s| s.into()),
            tool: tool.map(|s| s.into()),
            recovered: false,
            recovery_action: suggested_fix.clone(),
            frequency,
        };

        let mut log = self.classified.lock().map_err(|e| e.to_string())?;
        log.push(classified.clone());
        if log.len() > 1000 { log.remove(0); }

        Ok(classified)
    }

    pub fn mark_recovered(&self, id: &str, action: &str) -> Result<(), String> {
        let mut log = self.classified.lock().map_err(|e| e.to_string())?;
        if let Some(e) = log.iter_mut().find(|e| e.id == id) {
            e.recovered = true;
            e.recovery_action = Some(action.into());
        }
        Ok(())
    }

    pub fn get_stats(&self) -> Result<Vec<(ErrorCategory, u32, String)>, String> {
        let log = self.classified.lock().map_err(|e| e.to_string())?;
        let mut cat_map: HashMap<String, (ErrorCategory, u32, String)> = HashMap::new();
        for e in log.iter() {
            let label = format!("{:?}", e.category);
            let entry = cat_map.entry(label.clone()).or_insert((e.category.clone(), 0, String::new()));
            entry.1 += 1;
            if let Some(ref fix) = e.recovery_action {
                entry.2 = fix.clone();
            }
        }
        let mut result: Vec<(ErrorCategory, u32, String)> = cat_map.into_values().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1));
        Ok(result)
    }

    pub fn get_recent(&self, limit: usize) -> Result<Vec<ClassifiedError>, String> {
        let log = self.classified.lock().map_err(|e| e.to_string())?;
        Ok(log.iter().rev().take(limit).cloned().collect())
    }

    pub fn auto_fix(&self, category: &ErrorCategory) -> Option<&'static str> {
        match category {
            ErrorCategory::Auth => Some("switch_provider_or_check_key"),
            ErrorCategory::RateLimit => Some("retry_with_backoff"),
            ErrorCategory::Timeout => Some("retry_with_smaller_context"),
            ErrorCategory::ContextWindow => Some("start_new_session"),
            ErrorCategory::Network => Some("retry_with_fallback"),
            ErrorCategory::Provider => Some("retry_or_switch_provider"),
            ErrorCategory::ToolExecution => Some("verify_path_and_retry"),
            _ => None,
        }
    }

    pub fn add_pattern(&self, pattern: ErrorPattern) -> Result<(), String> {
        let mut patterns = self.patterns.lock().map_err(|e| e.to_string())?;
        patterns.push(pattern);
        Ok(())
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn errors_classify(
    classifier: tauri::State<'_, ErrorClassifier>,
    message: String, source: String, provider: Option<String>, model: Option<String>, tool: Option<String>,
) -> Result<ClassifiedError, String> {
    classifier.classify(&message, &source, provider.as_deref(), model.as_deref(), tool.as_deref())
}

#[tauri::command]
pub fn errors_stats(classifier: tauri::State<'_, ErrorClassifier>) -> Result<Vec<(ErrorCategory, u32, String)>, String> {
    classifier.get_stats()
}

#[tauri::command]
pub fn errors_recent(classifier: tauri::State<'_, ErrorClassifier>, limit: Option<usize>) -> Result<Vec<ClassifiedError>, String> {
    classifier.get_recent(limit.unwrap_or(50))
}

#[tauri::command]
pub fn errors_mark_recovered(classifier: tauri::State<'_, ErrorClassifier>, id: String, action: String) -> Result<(), String> {
    classifier.mark_recovered(&id, &action)
}

#[tauri::command]
pub fn errors_auto_fix(classifier: tauri::State<'_, ErrorClassifier>, category: ErrorCategory) -> Result<Option<String>, String> {
    Ok(classifier.auto_fix(&category).map(|s| s.to_string()))
}

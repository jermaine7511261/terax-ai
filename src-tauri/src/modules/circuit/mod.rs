use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct CircuitBreaker {
    pub name: String,
    pub state: CircuitState,
    pub failure_count: u64,
    pub success_count: u64,
    pub last_failure: String,
    pub last_success: String,
    pub opened_at: String,
    pub threshold: u64,
    pub timeout_secs: u64,
    pub half_open_max: u64,
}

pub struct CircuitBoard {
    breakers: Mutex<HashMap<String, CircuitBreaker>>,
}

impl Default for CircuitBoard {
    fn default() -> Self {
        let mut breakers = HashMap::new();
        for name in &["openai", "anthropic", "google", "xai", "groq", "deepseek", "mistral", "openrouter"] {
            breakers.insert(name.to_string(), CircuitBreaker {
                name: name.to_string(),
                state: CircuitState::Closed,
                failure_count: 0,
                success_count: 0,
                last_failure: String::new(),
                last_success: String::new(),
                opened_at: String::new(),
                threshold: 5,
                timeout_secs: 30,
                half_open_max: 3,
            });
        }
        Self { breakers: Mutex::new(breakers) }
    }
}

impl CircuitBoard {
    pub fn new() -> Self { Self::default() }

    fn now() -> String {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
    }

    fn now_secs() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
    }

    pub fn list(&self) -> Result<Vec<CircuitBreaker>, String> {
        let breakers = self.breakers.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<CircuitBreaker> = breakers.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    }

    pub fn get(&self, name: &str) -> Result<Option<CircuitBreaker>, String> {
        Ok(self.breakers.lock().map_err(|e| e.to_string())?.get(name).cloned())
    }

    pub fn register(&self, name: &str, threshold: u64, timeout_secs: u64) -> Result<(), String> {
        let mut breakers = self.breakers.lock().map_err(|e| e.to_string())?;
        breakers.insert(name.into(), CircuitBreaker {
            name: name.into(),
            state: CircuitState::Closed,
            failure_count: 0, success_count: 0,
            last_failure: String::new(), last_success: String::new(),
            opened_at: String::new(),
            threshold, timeout_secs, half_open_max: 3,
        });
        Ok(())
    }

    /// Check if a call is allowed through the circuit breaker.
    pub fn call_allowed(&self, name: &str) -> Result<bool, String> {
        let mut breakers = self.breakers.lock().map_err(|e| e.to_string())?;
        let cb = breakers.get_mut(name).ok_or_else(|| format!("Circuit breaker '{name}' not found"))?;

        match cb.state {
            CircuitState::Closed => Ok(true),
            CircuitState::Open => {
                let now = Self::now_secs();
                if let Ok(opened) = cb.opened_at.parse::<u64>() {
                    if now >= opened + cb.timeout_secs {
                        cb.state = CircuitState::HalfOpen;
                        cb.half_open_max = 3;
                        log::info!("circuit '{name}': open → half-open after {}s", cb.timeout_secs);
                        return Ok(true);
                    }
                }
                Ok(false)
            }
            CircuitState::HalfOpen => {
                if cb.half_open_max > 0 {
                    cb.half_open_max -= 1;
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
        }
    }

    /// Record a successful call.
    pub fn record_success(&self, name: &str) -> Result<(), String> {
        let mut breakers = self.breakers.lock().map_err(|e| e.to_string())?;
        let cb = breakers.get_mut(name).ok_or_else(|| format!("Circuit breaker '{name}' not found"))?;
        cb.success_count += 1;
        cb.last_success = Self::now();
        if cb.state == CircuitState::HalfOpen {
            cb.state = CircuitState::Closed;
            cb.failure_count = 0;
            log::info!("circuit '{name}': half-open → closed (success)");
        }
        Ok(())
    }

    /// Record a failed call.
    pub fn record_failure(&self, name: &str) -> Result<(), String> {
        let mut breakers = self.breakers.lock().map_err(|e| e.to_string())?;
        let cb = breakers.get_mut(name).ok_or_else(|| format!("Circuit breaker '{name}' not found"))?;
        cb.failure_count += 1;
        cb.last_failure = Self::now();

        if cb.failure_count >= cb.threshold && cb.state == CircuitState::Closed {
            cb.state = CircuitState::Open;
            cb.opened_at = Self::now();
            log::warn!("circuit '{name}': closed → OPEN ({}/{})", cb.failure_count, cb.threshold);
        }
        if cb.state == CircuitState::HalfOpen {
            cb.state = CircuitState::Open;
            cb.opened_at = Self::now();
            log::warn!("circuit '{name}': half-open → OPEN (retry failed)");
        }
        Ok(())
    }

    pub fn reset(&self, name: &str) -> Result<(), String> {
        let mut breakers = self.breakers.lock().map_err(|e| e.to_string())?;
        if let Some(cb) = breakers.get_mut(name) {
            cb.state = CircuitState::Closed;
            cb.failure_count = 0;
            cb.opened_at = String::new();
        }
        Ok(())
    }
}

#[tauri::command]
pub fn cb_list(board: tauri::State<'_, CircuitBoard>) -> Result<Vec<CircuitBreaker>, String> {
    board.list()
}

#[tauri::command]
pub fn cb_get(board: tauri::State<'_, CircuitBoard>, name: String) -> Result<Option<CircuitBreaker>, String> {
    board.get(&name)
}

#[tauri::command]
pub fn cb_register(board: tauri::State<'_, CircuitBoard>, name: String, threshold: u64, timeout_secs: u64) -> Result<(), String> {
    board.register(&name, threshold, timeout_secs)
}

#[tauri::command]
pub fn cb_call_allowed(board: tauri::State<'_, CircuitBoard>, name: String) -> Result<bool, String> {
    board.call_allowed(&name)
}

#[tauri::command]
pub fn cb_record_success(board: tauri::State<'_, CircuitBoard>, name: String) -> Result<(), String> {
    board.record_success(&name)
}

#[tauri::command]
pub fn cb_record_failure(board: tauri::State<'_, CircuitBoard>, name: String) -> Result<(), String> {
    board.record_failure(&name)
}

#[tauri::command]
pub fn cb_reset(board: tauri::State<'_, CircuitBoard>, name: String) -> Result<(), String> {
    board.reset(&name)
}

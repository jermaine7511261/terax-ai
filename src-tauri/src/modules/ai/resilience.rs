//! §3.2 Provider resilience: circuit breaker + fallback chain + retry policy.
//!
//! Inspired by daedra's 9-backend fallback with per-backend circuit breaker (30s
//! cooldown) and fetchira's free-tier-aware routing. This module provides the
//! pure data structures and logic for provider failover.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BreakerState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakerSnapshot {
    pub id: String,
    pub state: BreakerState,
    pub failure_count: u32,
    pub success_count: u32,
    pub opened_at: Option<u64>,
}

#[derive(Debug)]
pub struct CircuitBreaker {
    state: BreakerState,
    failure_count: u32,
    success_count: u32,
    opened_at: Option<Instant>,
    cooldown: Duration,
    threshold: u32,
    half_open_successes: u32,
}

impl CircuitBreaker {
    pub fn new(cooldown_ms: u64, threshold: u32) -> Self {
        Self {
            state: BreakerState::Closed,
            failure_count: 0,
            success_count: 0,
            opened_at: None,
            cooldown: Duration::from_millis(cooldown_ms),
            threshold,
            half_open_successes: 0,
        }
    }

    pub fn state(&self) -> BreakerState {
        // Check if Open should transition to HalfOpen after cooldown.
        if self.state == BreakerState::Open {
            if let Some(opened) = self.opened_at {
                if opened.elapsed() >= self.cooldown {
                    return BreakerState::HalfOpen;
                }
            }
        }
        self.state
    }

    pub fn is_available(&self) -> bool {
        self.state() != BreakerState::Open
    }

    pub fn record_success(&mut self) {
        match self.state {
            BreakerState::Closed => {
                self.failure_count = 0;
                self.success_count += 1;
            }
            BreakerState::HalfOpen => {
                self.half_open_successes += 1;
                self.success_count += 1;
                // After 2 consecutive successes, close the breaker.
                if self.half_open_successes >= 2 {
                    self.state = BreakerState::Closed;
                    self.failure_count = 0;
                    self.half_open_successes = 0;
                }
            }
            BreakerState::Open => {}
        }
    }

    pub fn record_failure(&mut self) {
        match self.state {
            BreakerState::Closed => {
                self.failure_count += 1;
                self.success_count = 0;
                if self.failure_count >= self.threshold {
                    self.state = BreakerState::Open;
                    self.opened_at = Some(Instant::now());
                }
            }
            BreakerState::HalfOpen => {
                // Any failure in HalfOpen re-opens.
                self.state = BreakerState::Open;
                self.opened_at = Some(Instant::now());
                self.half_open_successes = 0;
            }
            BreakerState::Open => {}
        }
    }

    pub fn snapshot(&self, id: String) -> BreakerSnapshot {
        BreakerSnapshot {
            id,
            state: self.state(),
            failure_count: self.failure_count,
            success_count: self.success_count,
            opened_at: self.opened_at.map(|t| t.elapsed().as_millis() as u64),
        }
    }
}

// ---------------------------------------------------------------------------
// Retry Policy
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub respect_retry_after: bool,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_ms: 1000,
            max_delay_ms: 8000,
            respect_retry_after: true,
        }
    }
}

impl RetryPolicy {
    /// Compute delay in ms for the given attempt (0-based).
    pub fn delay_for_attempt(&self, attempt: u32) -> u64 {
        let base = self.base_delay_ms.saturating_mul(1u64 << attempt);
        base.min(self.max_delay_ms)
    }
}

// ---------------------------------------------------------------------------
// Fallback Chain
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEntry {
    pub id: String,
    pub name: String,
    pub priority: u32,
}

// ---------------------------------------------------------------------------
// Global Breaker Registry
// ---------------------------------------------------------------------------

static BREAKERS: OnceLock<Mutex<BreakerRegistry>> = OnceLock::new();

struct BreakerRegistry {
    breakers: HashMap<String, CircuitBreaker>,
    default_cooldown_ms: u64,
    default_threshold: u32,
}

impl BreakerRegistry {
    fn new() -> Self {
        Self {
            breakers: HashMap::new(),
            default_cooldown_ms: 30_000,
            default_threshold: 3,
        }
    }

    fn get_or_insert(&mut self, id: &str) -> &mut CircuitBreaker {
        self.breakers
            .entry(id.to_string())
            .or_insert_with(|| CircuitBreaker::new(self.default_cooldown_ms, self.default_threshold))
    }

    fn snapshots(&self) -> Vec<BreakerSnapshot> {
        self.breakers
            .iter()
            .map(|(id, cb)| cb.snapshot(id.clone()))
            .collect()
    }
}

fn registry() -> &'static Mutex<BreakerRegistry> {
    BREAKERS.get_or_init(|| Mutex::new(BreakerRegistry::new()))
}

/// Record a success for the given provider.
#[tauri::command]
pub fn record_provider_success(provider_id: &str) {
    if let Ok(mut reg) = registry().lock() {
        reg.get_or_insert(provider_id).record_success();
    }
}

/// Record a failure for the given provider.
#[tauri::command]
pub fn record_provider_failure(provider_id: &str) {
    if let Ok(mut reg) = registry().lock() {
        reg.get_or_insert(provider_id).record_failure();
    }
}

/// Check if a provider is available (circuit breaker not open).
#[tauri::command]
pub fn is_provider_available(provider_id: &str) -> bool {
    registry()
        .lock()
        .map(|mut reg| reg.get_or_insert(provider_id).is_available())
        .unwrap_or(true)
}

/// Get snapshots of all breaker states (for settings UI).
pub fn all_breaker_snapshots() -> Vec<BreakerSnapshot> {
    registry()
        .lock()
        .map(|reg| reg.snapshots())
        .unwrap_or_default()
}

/// Tauri command: current circuit-breaker state for every provider, so the
/// settings UI can render the fallback chain with live status (R29 §3.2.2).
#[tauri::command]
pub fn resilience_status() -> Vec<BreakerSnapshot> {
    all_breaker_snapshots()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaker_starts_closed() {
        let cb = CircuitBreaker::new(30_000, 3);
        assert_eq!(cb.state(), BreakerState::Closed);
        assert!(cb.is_available());
    }

    #[test]
    fn breaker_opens_after_threshold_failures() {
        let mut cb = CircuitBreaker::new(30_000, 3);
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), BreakerState::Closed);
        cb.record_failure(); // 3rd failure → open
        assert_eq!(cb.state(), BreakerState::Open);
        assert!(!cb.is_available());
    }

    #[test]
    fn breaker_resets_failure_count_on_success() {
        let mut cb = CircuitBreaker::new(30_000, 3);
        cb.record_failure();
        cb.record_failure();
        cb.record_success();
        assert_eq!(cb.failure_count, 0);
        assert_eq!(cb.state(), BreakerState::Closed);
    }

    #[test]
    fn retry_policy_delays_increase_exponentially() {
        let p = RetryPolicy::default();
        assert_eq!(p.delay_for_attempt(0), 1000);
        assert_eq!(p.delay_for_attempt(1), 2000);
        assert_eq!(p.delay_for_attempt(2), 4000);
        assert_eq!(p.delay_for_attempt(3), 8000); // capped
        assert_eq!(p.delay_for_attempt(4), 8000); // still capped
    }

    #[test]
    fn breaker_half_open_transitions_via_snapshots() {
        // Use a tiny cooldown for testing.
        let mut cb = CircuitBreaker::new(1, 2);
        cb.record_failure();
        cb.record_failure(); // open
        assert_eq!(cb.state(), BreakerState::Open);
        // After the cooldown (1ms), snapshot returns HalfOpen.
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(cb.state(), BreakerState::HalfOpen);
    }
}

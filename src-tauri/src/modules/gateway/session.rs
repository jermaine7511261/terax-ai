//! Session key routing, mirroring Hermes `session.py`.
//! Key format: `agent:main:{platform}:{chat_type}:{chat_id}`.
//!
//! The router keeps recent active sessions in memory and can persist them
//! through a JSON file under the app data dir.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub session_key: String,
    pub platform: String,
    pub chat_type: String,
    pub chat_id: String,
    pub last_active_ms: u64,
    pub auto_approve: bool,
    pub awaiting_approval: bool,
    /// Explicitly authorized to drive the agent (whitelist membership).
    pub authorized: bool,
}

impl SessionState {
    pub fn new(session_key: String, platform: &str, chat_type: &str, chat_id: &str) -> Self {
        Self {
            session_key,
            platform: platform.to_string(),
            chat_type: chat_type.to_string(),
            chat_id: chat_id.to_string(),
            last_active_ms: now_ms(),
            auto_approve: false,
            awaiting_approval: false,
            authorized: false,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct SessionRouter {
    inner: Mutex<HashMap<String, SessionState>>,
}

impl SessionRouter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Touch (create or refresh) a session for a message's session key.
    pub fn touch(&self, session_key: &str, platform: &str, chat_type: &str, chat_id: &str) -> SessionState {
        let mut map = self.inner.lock().unwrap();
        let entry = map
            .entry(session_key.to_string())
            .or_insert_with(|| SessionState::new(session_key.to_string(), platform, chat_type, chat_id));
        entry.last_active_ms = now_ms();
        entry.chat_type = chat_type.to_string();
        entry.chat_id = chat_id.to_string();
        entry.clone()
    }

    pub fn get(&self, session_key: &str) -> Option<SessionState> {
        self.inner.lock().unwrap().get(session_key).cloned()
    }

    pub fn set_auto_approve(&self, session_key: &str, value: bool) {
        if let Some(s) = self.inner.lock().unwrap().get_mut(session_key) {
            s.auto_approve = value;
        }
    }

    pub fn set_awaiting_approval(&self, session_key: &str, value: bool) {
        if let Some(s) = self.inner.lock().unwrap().get_mut(session_key) {
            s.awaiting_approval = value;
        }
    }

    pub fn all(&self) -> Vec<SessionState> {
        let mut out: Vec<_> = self.inner.lock().unwrap().values().cloned().collect();
        out.sort_by_key(|s| std::cmp::Reverse(s.last_active_ms));
        out
    }

    pub fn remove(&self, session_key: &str) {
        self.inner.lock().unwrap().remove(session_key);
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }

    /// Whether a session may drive the agent (explicit authorization or
    /// per-session auto-approve). **Default is deny**.
    pub fn is_authorized(&self, session_key: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .get(session_key)
            .map(|s| s.authorized || s.auto_approve)
            .unwrap_or(false)
    }

    /// Mark an un-authorized session as awaiting approval (queued for the
    /// user to review) — its message must NOT drive the agent.
    pub fn request_approval(&self, session_key: &str) {
        if let Some(s) = self.inner.lock().unwrap().get_mut(session_key) {
            if !s.authorized && !s.auto_approve {
                s.awaiting_approval = true;
            }
        }
    }

    /// Approve a session (add to the whitelist). Subsequent messages drive
    /// the agent.
    pub fn approve(&self, session_key: &str) {
        if let Some(s) = self.inner.lock().unwrap().get_mut(session_key) {
            s.authorized = true;
            s.awaiting_approval = false;
        }
    }

    /// Revoke authorization (back to default-deny).
    pub fn revoke(&self, session_key: &str) {
        if let Some(s) = self.inner.lock().unwrap().get_mut(session_key) {
            s.authorized = false;
        }
    }
}

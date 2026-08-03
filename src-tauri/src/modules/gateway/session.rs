//! Session key routing, mirroring Hermes `session.py`.
//! Key format: `agent:main:{platform}:{chat_type}:{chat_id}`.
//!
//! The router keeps recent active sessions in memory and persists the
//! authorization whitelist (authorized / auto-approve sessions) to a JSON file
//! under the app data dir, so approved sessions survive app restarts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
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

/// Subset of `SessionState` that is persisted: only the authorization-relevant
/// fields. Everything else (activity timestamps, pending flags) is rebuilt from
/// live traffic after restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedSession {
    session_key: String,
    platform: String,
    chat_type: String,
    chat_id: String,
    auto_approve: bool,
    authorized: bool,
}

impl From<&SessionState> for PersistedSession {
    fn from(s: &SessionState) -> Self {
        Self {
            session_key: s.session_key.clone(),
            platform: s.platform.clone(),
            chat_type: s.chat_type.clone(),
            chat_id: s.chat_id.clone(),
            auto_approve: s.auto_approve,
            authorized: s.authorized,
        }
    }
}

#[derive(Default)]
pub struct SessionRouter {
    inner: Mutex<HashMap<String, SessionState>>,
    /// JSON file the authorization whitelist is persisted to. `None` = no
    /// persistence (e.g. unit tests).
    persist_path: Mutex<Option<PathBuf>>,
}

impl SessionRouter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Enable persistence to `path` and load any previously saved whitelist.
    pub fn set_persist_path(&self, path: PathBuf) {
        if let Some(saved) = Self::load_from(&path) {
            let mut map = self.inner.lock().unwrap();
            for s in saved {
                let key = s.session_key.clone();
                let entry = map
                    .entry(key)
                    .or_insert_with(|| SessionState::new(s.session_key, &s.platform, &s.chat_type, &s.chat_id));
                entry.auto_approve = s.auto_approve;
                entry.authorized = s.authorized;
            }
        }
        *self.persist_path.lock().unwrap() = Some(path);
    }

    fn persist_path(&self) -> Option<PathBuf> {
        self.persist_path.lock().unwrap().clone()
    }

    /// Atomically write the authorization whitelist to disk. Only sessions with
    /// `authorized` or `auto_approve` are saved — everything else is default-deny
    /// and will simply be re-requested after restart.
    fn persist(&self) {
        let Some(path) = self.persist_path() else {
            return;
        };
        let saved: Vec<PersistedSession> = self
            .inner
            .lock()
            .unwrap()
            .values()
            .filter(|s| s.authorized || s.auto_approve)
            .map(PersistedSession::from)
            .collect();
        let bytes = match serde_json::to_vec_pretty(&saved) {
            Ok(b) => b,
            Err(e) => {
                log::warn!("gateway session persist serialize failed: {e}");
                return;
            }
        };
        let tmp = path.with_extension("json.tmp");
        if let Err(e) = std::fs::write(&tmp, &bytes) {
            log::warn!("gateway session persist write failed: {e}");
            return;
        }
        if let Err(e) = std::fs::rename(&tmp, &path) {
            log::warn!("gateway session persist rename failed: {e}");
        }
    }

    fn load_from(path: &std::path::Path) -> Option<Vec<PersistedSession>> {
        if !path.exists() {
            return None;
        }
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).ok(),
            Err(e) => {
                log::warn!("gateway session restore read failed: {e}");
                None
            }
        }
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
        self.persist();
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
        self.persist();
    }

    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
        self.persist();
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
        self.persist();
    }

    /// Revoke authorization (back to default-deny).
    pub fn revoke(&self, session_key: &str) {
        if let Some(s) = self.inner.lock().unwrap().get_mut(session_key) {
            s.authorized = false;
        }
        self.persist();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist_survives_restart_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");

        // First "process": touch + approve two sessions, auto-approve one.
        let router = SessionRouter::new();
        router.set_persist_path(path.clone());
        router.touch("agent:main:wecom:dm:u1", "wecom", "dm", "u1");
        router.touch("agent:main:weixin:group:g1", "weixin", "group", "g1");
        router.touch("agent:main:qq:dm:u2", "qq", "dm", "u2");
        router.approve("agent:main:wecom:dm:u1");
        router.approve("agent:main:weixin:group:g1");
        router.set_auto_approve("agent:main:qq:dm:u2", true);
        assert!(path.exists(), "persist file must exist after approve");

        // Second "process": fresh router restores the whitelist.
        let restored = SessionRouter::new();
        restored.set_persist_path(path.clone());
        assert!(restored.is_authorized("agent:main:wecom:dm:u1"));
        assert!(restored.is_authorized("agent:main:weixin:group:g1"));
        assert!(restored.is_authorized("agent:main:qq:dm:u2"));
        // Non-whitelisted sessions stay default-deny.
        assert!(!restored.is_authorized("agent:main:dingtalk:dm:u9"));
    }

    #[test]
    fn revoke_removes_from_whitelist() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let router = SessionRouter::new();
        router.set_persist_path(path.clone());
        router.touch("agent:main:wecom:dm:u1", "wecom", "dm", "u1");
        router.approve("agent:main:wecom:dm:u1");
        router.revoke("agent:main:wecom:dm:u1");

        let restored = SessionRouter::new();
        restored.set_persist_path(path.clone());
        assert!(!restored.is_authorized("agent:main:wecom:dm:u1"));
    }
}

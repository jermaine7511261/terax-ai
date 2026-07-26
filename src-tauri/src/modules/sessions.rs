use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub enum SessionStatus {
    Idle,
    Running,
    Paused,
    AwaitingApproval,
    Error(String),
    Completed,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub name: String,
    pub agent_type: String,
    pub model_id: String,
    pub status: SessionStatus,
    pub progress: String,
    pub step_count: u32,
    pub max_steps: u32,
    pub created_at: String,
    pub updated_at: String,
    pub tool_counts: HashMap<String, u32>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub error: Option<String>,
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, AgentSession>>,
    active_id: Mutex<Option<String>>,
    next_id: Mutex<u64>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            active_id: Mutex::new(None),
            next_id: Mutex::new(1),
        }
    }
}

impl SessionManager {
    pub fn new() -> Self { Self::default() }

    fn ts() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
    }

    pub fn create_session(&self, name: &str, agent_type: &str, model_id: &str, max_steps: u32) -> Result<AgentSession, String> {
        let mut next = self.next_id.lock().map_err(|e| e.to_string())?;
        let id = format!("sess-{}", *next);
        *next += 1;
        drop(next);

        let now = Self::ts();
        let session = AgentSession {
            id,
            name: name.into(),
            agent_type: agent_type.into(),
            model_id: model_id.into(),
            status: SessionStatus::Idle,
            progress: "Created".into(),
            step_count: 0,
            max_steps,
            created_at: now.clone(),
            updated_at: now,
            tool_counts: HashMap::new(),
            input_tokens: 0,
            output_tokens: 0,
            error: None,
        };

        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let clone = session.clone();
        sessions.insert(session.id.clone(), session);
        Ok(clone)
    }

    pub fn list_sessions(&self) -> Result<Vec<AgentSession>, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<AgentSession> = sessions.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(list)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<AgentSession>, String> {
        Ok(self.sessions.lock().map_err(|e| e.to_string())?.get(id).cloned())
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let mut active = self.active_id.lock().map_err(|e| e.to_string())?;
        sessions.remove(id);
        if active.as_deref() == Some(id) {
            *active = sessions.keys().next().cloned();
        }
        Ok(())
    }

    pub fn update_session(&self, id: &str, f: impl FnOnce(&mut AgentSession)) -> Result<AgentSession, String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get_mut(id).ok_or_else(|| format!("Session not found: {id}"))?;
        f(session);
        session.updated_at = Self::ts();
        Ok(session.clone())
    }

    pub fn set_active(&self, id: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if !sessions.contains_key(id) {
            return Err(format!("Session not found: {id}"));
        }
        let mut active = self.active_id.lock().map_err(|e| e.to_string())?;
        *active = Some(id.into());
        Ok(())
    }

    pub fn get_active(&self) -> Result<Option<AgentSession>, String> {
        let active = self.active_id.lock().map_err(|e| e.to_string())?;
        match active.as_ref() {
            Some(id) => self.get_session(id),
            None => Ok(None),
        }
    }

    pub fn record_tool_call(&self, session_id: &str, tool_name: &str, tokens: u64) -> Result<(), String> {
        self.update_session(session_id, |s| {
            *s.tool_counts.entry(tool_name.into()).or_insert(0) += 1;
            s.input_tokens += tokens;
        })?;
        Ok(())
    }

    pub fn cleanup_stale(&self) -> Result<u32, String> {
        let now = Self::ts();
        let now_secs: u64 = now.parse().unwrap_or(0);
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let before = sessions.len();
        // Remove error sessions older than 1 hour
        sessions.retain(|_, s| {
            if let SessionStatus::Error(_) = &s.status {
                if let Ok(ts) = s.updated_at.parse::<u64>() {
                    if now_secs.saturating_sub(ts) > 3600 {
                        return false;
                    }
                }
            }
            true
        });
        let after = sessions.len();
        let removed = (before - after) as u32;
        if removed > 0 {
            log::info!("session_manager: cleaned up {removed} stale sessions");
        }
        Ok(removed)
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn sess_create(
    mgr: tauri::State<'_, SessionManager>,
    name: String, agent_type: String, model_id: String, max_steps: u32,
) -> Result<AgentSession, String> {
    mgr.create_session(&name, &agent_type, &model_id, max_steps)
}

#[tauri::command]
pub fn sess_list(mgr: tauri::State<'_, SessionManager>) -> Result<Vec<AgentSession>, String> {
    mgr.list_sessions()
}

#[tauri::command]
pub fn sess_get(mgr: tauri::State<'_, SessionManager>, id: String) -> Result<Option<AgentSession>, String> {
    mgr.get_session(&id)
}

#[tauri::command]
pub fn sess_delete(mgr: tauri::State<'_, SessionManager>, id: String) -> Result<(), String> {
    mgr.delete_session(&id)
}

#[tauri::command]
pub fn sess_set_active(mgr: tauri::State<'_, SessionManager>, id: String) -> Result<(), String> {
    mgr.set_active(&id)
}

#[tauri::command]
pub fn sess_get_active(mgr: tauri::State<'_, SessionManager>) -> Result<Option<AgentSession>, String> {
    mgr.get_active()
}

#[tauri::command]
pub fn sess_update_status(
    mgr: tauri::State<'_, SessionManager>,
    id: String, status: String, progress: String,
) -> Result<AgentSession, String> {
    let s = match status.as_str() {
        "idle" => SessionStatus::Idle,
        "running" => SessionStatus::Running,
        "paused" => SessionStatus::Paused,
        "approval" => SessionStatus::AwaitingApproval,
        "completed" => SessionStatus::Completed,
        _ => SessionStatus::Error("unknown status".into()),
    };
    mgr.update_session(&id, |sess| {
        sess.status = s;
        sess.progress = progress;
        sess.step_count += 1;
    })
}

#[tauri::command]
pub fn sess_cleanup(mgr: tauri::State<'_, SessionManager>) -> Result<u32, String> {
    mgr.cleanup_stale()
}

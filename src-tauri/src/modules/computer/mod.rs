//! Computer use (P3): M1 capture (Windows), M2 input-injection gating + budget.
//! The safety core (`safety.rs`) is pure and cross-platform; the platform layer
//! (`platform.rs`) is Windows-first per decision 4.

pub mod platform;
pub mod safety;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use base64::Engine;
use serde::Serialize;
use tauri::State;

use self::safety::{
    ComputerAction, MAX_ACTIONS_PER_SESSION, budget_exceeded, gate_input, validate_action,
};

pub struct ComputerUseState {
    sessions: RwLock<HashMap<u32, Arc<ComputerUseSession>>>,
    next_id: AtomicU32,
}

impl Default for ComputerUseState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

/// A computer-use session gates input injection behind approval + budget.
pub struct ComputerUseSession {
    pub id: u32,
    pub actions_used: AtomicU32,
    pub auto_approved: AtomicBool,
    pub privacy_on: AtomicBool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerCaptureResult {
    pub ok: bool,
    /// PNG as a data URI for the vision call (`image_url` data-URI, hermes).
    pub image_data_url: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub scale: Option<f64>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn computer_session_open(
    state: State<'_, ComputerUseState>,
) -> Result<u32, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let s = Arc::new(ComputerUseSession {
        id,
        actions_used: AtomicU32::new(0),
        auto_approved: AtomicBool::new(false),
        privacy_on: AtomicBool::new(true),
    });
    state.sessions.write().unwrap_or_else(|e| e.into_inner()).insert(id, s);
    log::info!("computer use session opened id={id}");
    Ok(id)
}

#[tauri::command]
pub fn computer_session_close(state: State<'_, ComputerUseState>, id: u32) -> Result<(), String> {
    if state.sessions.write().unwrap_or_else(|e| e.into_inner()).remove(&id).is_some() {
        log::info!("computer use session closed id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn computer_approve(state: State<'_, ComputerUseState>, id: u32) -> Result<(), String> {
    let s = session(&state, id)?;
    s.auto_approved.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn computer_revoke(state: State<'_, ComputerUseState>, id: u32) -> Result<(), String> {
    let s = session(&state, id)?;
    s.auto_approved.store(false, Ordering::Release);
    Ok(())
}

fn session(state: &ComputerUseState, id: u32) -> Result<Arc<ComputerUseSession>, String> {
    state
        .sessions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no computer use session {id}"))
}

/// M1: capture the screen as a PNG data URI (read-only, no approval needed).
#[tauri::command]
pub fn computer_capture(state: State<'_, ComputerUseState>, id: u32) -> ComputerCaptureResult {
    let _ = (state, id);
    match platform::capture_screen() {
        Ok(cap) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&cap.png);
            ComputerCaptureResult {
                ok: true,
                image_data_url: Some(format!("data:image/png;base64,{b64}")),
                width: Some(cap.width),
                height: Some(cap.height),
                scale: Some(cap.scale),
                error: None,
            }
        }
        Err(e) => ComputerCaptureResult {
            ok: false,
            image_data_url: None,
            width: None,
            height: None,
            scale: None,
            error: Some(e),
        },
    }
}

/// M2: input injection, gated by approval + sensitive regions + action budget.
#[tauri::command]
pub fn computer_action(
    state: State<'_, ComputerUseState>,
    id: u32,
    action: ComputerAction,
) -> Result<String, String> {
    if let Some(err) = validate_action(&action) {
        return Ok(format!("{{ \"error\": \"{err}\" }}"));
    }
    let s = session(&state, id)?;
    let auto = s.auto_approved.load(Ordering::Acquire);
    if let Some(reason) = gate_input(&action, auto) {
        return Ok(format!("{{ \"needsApproval\": \"{reason}\" }}"));
    }
    let used = s.actions_used.fetch_add(1, Ordering::AcqRel) + 1;
    if budget_exceeded(used, MAX_ACTIONS_PER_SESSION) {
        return Ok("{ \"error\": \"action budget exceeded\" }".into());
    }
    // M2 milestone: platform input injection lands with the vision loop in the
    // same milestone; until then the gated action is recorded (mock-safe).
    Ok(format!(
        "{{ \"ok\": true, \"action\": \"{:?}\", \"actionsUsed\": {used} }}",
        action.kind
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_gated_before_execution() {
        // Exercise the gate logic directly (State can't be constructed in a
        // unit test); the command wrapper is a thin pass-through.
        let click = ComputerAction {
            kind: safety::ActionKind::Click,
            x: Some(0.5),
            y: Some(0.5),
            ..Default::default()
        };
        assert!(safety::gate_input(&click, false).is_some()); // needs approval
        assert!(safety::gate_input(&click, true).is_none());
        assert!(validate_action(&click).is_none());
    }

    #[test]
    fn session_state_defaults() {
        let s = ComputerUseSession {
            id: 1,
            actions_used: AtomicU32::new(0),
            auto_approved: AtomicBool::new(false),
            privacy_on: AtomicBool::new(true),
        };
        assert_eq!(s.actions_used.load(Ordering::Acquire), 0);
        assert!(s.privacy_on.load(Ordering::Acquire));
    }
}

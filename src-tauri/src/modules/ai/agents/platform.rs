//! Agent platform commands (R28): exposes the registry, lifecycle state
//! machine, and execution trace to the frontend. State is managed by the
//! `AgentPlatformState` (registry + lifecycle manager); trace spans are
//! created/closed by the agent harness via `TraceRecorder`.

use std::collections::HashMap;

use serde::Serialize;
use tauri::Manager;
use tauri::State;

use super::agent_def::AgentDef;
use super::agent_registry::{AgentRegistry, AgentSource};
use super::lifecycle::{AgentInstance, AgentLifecycleManager, AgentRunRecord, AgentState, StepRecord, TokenUsage};

pub struct AgentPlatformState {
    pub registry: AgentRegistry,
    pub lifecycle: AgentLifecycleManager,
    /// R28 #16 message steering: pending per-session steering notes injected
    /// into the next agent turn ( nudge / MessageSteeringProtocol).
    steers: std::sync::RwLock<HashMap<String, Vec<String>>>,
}

impl Default for AgentPlatformState {
    fn default() -> Self {
        Self {
            registry: AgentRegistry::new(),
            lifecycle: AgentLifecycleManager::new(),
            steers: std::sync::RwLock::new(HashMap::new()),
        }
    }
}

/// R28 #16: append a steering instruction for a session.
#[tauri::command]
pub fn agent_steer_add(
    state: State<'_, AgentPlatformState>,
    session_id: String,
    note: String,
) -> Result<(), String> {
    let note = note.trim().to_string();
    if note.is_empty() {
        return Err("steer note cannot be empty".into());
    }
    state
        .steers
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .entry(session_id)
        .or_default()
        .push(note);
    Ok(())
}

#[tauri::command]
pub fn agent_steer_list(state: State<'_, AgentPlatformState>, session_id: String) -> Vec<String> {
    state
        .steers
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&session_id)
        .cloned()
        .unwrap_or_default()
}

/// R28 #16: consume (drain) the pending steers for a session — the harness
/// calls this when building the next turn's prompt.
#[tauri::command]
pub fn agent_steer_drain(state: State<'_, AgentPlatformState>, session_id: String) -> Vec<String> {
    state
        .steers
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&session_id)
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListEntry {
    pub def: AgentDef,
    pub source: String,
}

#[tauri::command]
pub fn agent_registry_list(state: State<'_, AgentPlatformState>) -> Vec<AgentListEntry> {
    state
        .registry
        .all()
        .into_iter()
        .map(|def| AgentListEntry {
            source: match state.registry.source_of(&def.id) {
                Some(AgentSource::BuiltIn) => "builtin".to_string(),
                Some(AgentSource::Workspace(_)) => "workspace".to_string(),
                Some(AgentSource::User(_)) => "user".to_string(),
                Some(AgentSource::SkillDerived(id)) => format!("skill:{id}"),
                None => "unknown".to_string(),
            },
            def,
        })
        .collect()
}

#[tauri::command]
pub fn agent_registry_get(state: State<'_, AgentPlatformState>, id: String) -> Option<AgentDef> {
    state.registry.get(&id)
}

#[tauri::command]
pub fn agent_registry_delegatable(state: State<'_, AgentPlatformState>) -> Vec<AgentDef> {
    state.registry.list_delegatable()
}

#[tauri::command]
pub fn agent_registry_primary(state: State<'_, AgentPlatformState>) -> Vec<AgentDef> {
    state.registry.list_primary()
}

#[tauri::command]
pub fn agent_registry_register(
    state: State<'_, AgentPlatformState>,
    def: AgentDef,
    source: String,
) -> Result<(), String> {
    let src = validate_register(&def, &source)?;
    state.registry.register(def, src);
    Ok(())
}

/// Validate a registration request and map the source label to an enum.
/// Pure — unit-tested (tauri `State` is not constructible in tests).
fn validate_register(def: &AgentDef, source: &str) -> Result<AgentSource, String> {
    if def.id.trim().is_empty() {
        return Err("agent id is required".into());
    }
    if def.system_prompt.trim().is_empty() {
        return Err("agent system_prompt is required".into());
    }
    Ok(match source {
        "workspace" => AgentSource::Workspace(std::path::PathBuf::new()),
        "skill" => AgentSource::SkillDerived(def.id.clone()),
        _ => AgentSource::User(std::path::PathBuf::new()),
    })
}

#[tauri::command]
pub fn agent_registry_remove(state: State<'_, AgentPlatformState>, id: String) {
    state.registry.remove(&id);
}

// ── lifecycle ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn agent_instance_create(
    state: State<'_, AgentPlatformState>,
    def_id: String,
    session_id: String,
    parent_id: Option<String>,
    depth: Option<u32>,
) -> Result<String, String> {
    if state.registry.get(&def_id).is_none() {
        return Err(format!("no agent definition {def_id}"));
    }
    Ok(state
        .lifecycle
        .create(def_id, session_id, parent_id, depth.unwrap_or(0)))
}

#[tauri::command]
pub fn agent_instance_get(state: State<'_, AgentPlatformState>, id: String) -> Option<AgentInstance> {
    state.lifecycle.get(&id)
}

#[tauri::command]
pub fn agent_instance_transition(
    state: State<'_, AgentPlatformState>,
    id: String,
    next: AgentState,
) -> Result<(), String> {
    state.lifecycle.transition(&id, next)
}

#[tauri::command]
pub fn agent_instance_record_step(
    state: State<'_, AgentPlatformState>,
    id: String,
    step: u32,
    token_delta: TokenUsage,
    cost_delta: f64,
) -> Result<(), String> {
    state
        .lifecycle
        .record_step(&id, step, token_delta, cost_delta)
}

#[tauri::command]
pub fn agent_instance_finalize(
    state: State<'_, AgentPlatformState>,
    id: String,
    input: String,
    output: Option<String>,
    steps: Vec<StepRecord>,
) -> Result<AgentRunRecord, String> {
    state.lifecycle.finalize(&id, input, output, steps)
}

#[tauri::command]
pub fn agent_history(state: State<'_, AgentPlatformState>, def_id: Option<String>) -> Vec<AgentRunRecord> {
    match def_id {
        Some(id) => state.lifecycle.history_for(&id),
        None => state.lifecycle.history(),
    }
}

/// R28 #11: cost-budget gate. The harness checks the agent's accumulated cost
/// against its budget cap before each step and stops when exceeded.
#[tauri::command]
pub fn agent_within_budget(cost_usd: f64, budget_cap: Option<f64>) -> bool {
    super::lifecycle::within_budget(cost_usd, budget_cap)
}

/// R28 #6: checkpoint the whole platform state (history + live instances) to
/// `<data>/agent-platform.json` so runs survive an app restart.
#[tauri::command]
pub fn agent_checkpoint_save(
    state: State<'_, AgentPlatformState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = checkpoint_path(&app)?;
    let json = super::lifecycle::serialize_state(&state.lifecycle);
    let bytes = serde_json::to_vec_pretty(&json).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// R28 #6: resume the platform state from the last checkpoint.
#[tauri::command]
pub fn agent_checkpoint_restore(
    state: State<'_, AgentPlatformState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = checkpoint_path(&app)?;
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(()); // no checkpoint yet — nothing to resume
    };
    let raw = String::from_utf8_lossy(&bytes);
    let (history, instances) = super::lifecycle::deserialize_state(&raw);
    state.lifecycle.restore_state(history, instances);
    Ok(())
}

fn checkpoint_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("agent-platform.json"))
}

// ── R28 #12 templates / #13 skill fork ──────────────────────────────────────

/// List built-in agent templates (R28 #12).
#[tauri::command]
pub fn agent_template_list() -> Vec<AgentDef> {
    super::templates::builtin_templates()
}

/// Clone a built-in template into a new registered agent (R28 #12).
#[tauri::command]
pub fn agent_template_clone(
    state: State<'_, AgentPlatformState>,
    template_id: String,
    new_id: String,
    name: Option<String>,
) -> Result<AgentDef, String> {
    let tpl = super::templates::builtin_templates()
        .into_iter()
        .find(|t| t.id == template_id)
        .ok_or_else(|| format!("no template {template_id}"))?;
    if new_id.trim().is_empty() {
        return Err("new agent id is required".into());
    }
    let def = super::templates::clone_template(&tpl, &new_id, name.as_deref());
    state
        .registry
        .register(def.clone(), AgentSource::User(std::path::PathBuf::new()));
    Ok(def)
}

/// Derive a new sub-agent from a skill (R28 #13) and register it. The caller
/// (frontend) resolves the skill's prompt + tool allowlist from the skill
/// store; this command stays pure.
#[tauri::command]
pub fn agent_skill_fork(
    state: State<'_, AgentPlatformState>,
    skill_name: String,
    description: String,
    prompt: String,
    tool_allowlist: Vec<String>,
    model_override: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<AgentDef, String> {
    if skill_name.trim().is_empty() || prompt.trim().is_empty() {
        return Err("skill name and prompt are required".into());
    }
    let new_id = format!("skill:{}", skill_name.trim().to_lowercase().replace(' ', "-"));
    let source = super::skill_fork::SkillSource {
        name: skill_name,
        description,
        prompt,
        tool_allowlist,
    };
    let def = super::skill_fork::derive_agent_from_skill(
        &source,
        &new_id,
        model_override,
        reasoning_effort,
    );
    state
        .registry
        .register(def.clone(), AgentSource::SkillDerived(new_id));
    Ok(def)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_validates_required_fields() {
        let ok = validate_register(
            &AgentDef {
                id: "x".into(),
                system_prompt: "p".into(),
                ..Default::default()
            },
            "user",
        );
        assert!(ok.is_ok());
        assert!(validate_register(&AgentDef::default(), "user").is_err());
        let no_prompt = AgentDef {
            id: "y".into(),
            ..Default::default()
        };
        assert!(validate_register(&no_prompt, "user").is_err());
    }

    #[test]
    fn registry_integration_via_managers() {
        let st = AgentPlatformState::default();
        let def = AgentDef {
            id: "reviewer".into(),
            name: "Reviewer".into(),
            system_prompt: "review".into(),
            ..Default::default()
        };
        st.registry.register(def.clone(), AgentSource::BuiltIn);
        assert!(st.registry.get(&"reviewer".to_string()).is_some());
        let id = st.lifecycle.create("reviewer".into(), "sess".into(), None, 0);
        st.lifecycle.transition(&id, AgentState::Running).unwrap();
        st.lifecycle.transition(&id, AgentState::Idle).unwrap();
        let rec = st
            .lifecycle
            .finalize(&id, "task".into(), Some("ok".into()), vec![])
            .unwrap();
        assert_eq!(rec.def_id, "reviewer");
        assert_eq!(st.lifecycle.history().len(), 1);
    }
}

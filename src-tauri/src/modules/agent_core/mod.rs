//! Agent Core — autonomous AI agent engine for OpenAgent.
//!
//! This module provides a Think→Act→Observe agent loop that can:
//! - Call LLMs via OpenAI-compatible APIs
//! - Execute tools (read/write files, grep, glob, bash, etc.)
//! - Manage multiple agent sessions
//! - Track context and token usage
//!
//! Exposed as Tauri commands:
//! - `agent_core_start` — start a new agent session
//! - `agent_core_step` — run one step of the loop
//! - `agent_core_run` — run to completion (async, background)
//! - `agent_core_status` — get session status
//! - `agent_core_stop` — stop a running agent
//! - `agent_core_list` — list all sessions
//! - `agent_core_delete` — delete a session

mod agent_loop;
pub mod llm;
pub mod tool;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::State;

use agent_loop::{AgentConfig, AgentInstance, AgentRunner, AgentStatus, Turn};
use tool::ToolRegistry;

/// Manages all agent instances and shared state.
pub struct AgentEngine {
    /// Agent instances keyed by ID.
    instances: Mutex<HashMap<String, AgentInstance>>,
    /// Shared tool registry.
    registry: Arc<ToolRegistry>,
    /// Monotonically increasing ID counter.
    next_id: AtomicU64,
}

impl AgentEngine {
    pub fn new(working_dir: &str) -> Self {
        let registry = Arc::new(
            tool::build_default_registry(working_dir, None),
        );

        Self {
            instances: Mutex::new(HashMap::new()),
            registry,
            next_id: AtomicU64::new(1),
        }
    }

    /// Create a new agent session.
    pub fn create_session(
        &self,
        config: AgentConfig,
    ) -> Result<AgentInstance, String> {
        let id = format!("agent-{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        let instance = AgentInstance::new(id.clone(), config);
        let mut instances = self.instances.lock().map_err(|e| e.to_string())?;
        instances.insert(id.clone(), instance.clone_for_status());
        Ok(instance)
    }

    /// Get a clone of an agent instance (for status queries).
    pub fn get_instance(&self, id: &str) -> Result<AgentInstance, String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        instances
            .get(id)
            .map(|i| i.clone_for_status())
            .ok_or_else(|| format!("agent session not found: {id}"))
    }

    /// List all sessions.
    pub fn list_sessions(&self) -> Result<Vec<AgentInstance>, String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<AgentInstance> = instances.values().map(|i| i.clone_for_status()).collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(list)
    }

    /// Delete a session.
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let mut instances = self.instances.lock().map_err(|e| e.to_string())?;
        instances.remove(id);
        Ok(())
    }

    /// Stop a running agent session.
    pub fn stop_session(&self, id: &str) -> Result<(), String> {
        let instances = self.instances.lock().map_err(|e| e.to_string())?;
        if let Some(instance) = instances.get(id) {
            instance.stop();
            Ok(())
        } else {
            Err(format!("agent session not found: {id}"))
        }
    }

    /// Run one step on an agent session.
    pub fn run_step(&self, id: &str) -> Result<StepResult, String> {
        let mut instances = self.instances.lock().map_err(|e| e.to_string())?;
        let instance = instances
            .get_mut(id)
            .ok_or_else(|| format!("agent session not found: {id}"))?;

        let runner = AgentRunner::new(self.registry.clone());
        let status = runner.step(instance)?;

        let last_turn = instance.turn_history.last().cloned();
        Ok(StepResult {
            id: id.to_string(),
            status: format_status(&status),
            step: instance.step_count,
            total_prompt_tokens: instance.total_prompt_tokens,
            total_completion_tokens: instance.total_completion_tokens,
            last_turn,
            error: match &status {
                AgentStatus::Error(e) => Some(e.clone()),
                _ => None,
            },
        })
    }
}

/// Status snapshot returned to the frontend.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StepResult {
    pub id: String,
    pub status: String,
    pub step: u32,
    pub total_prompt_tokens: u32,
    pub total_completion_tokens: u32,
    pub last_turn: Option<Turn>,
    pub error: Option<String>,
}

fn format_status(s: &AgentStatus) -> String {
    match s {
        AgentStatus::Idle => "idle".into(),
        AgentStatus::Thinking => "thinking".into(),
        AgentStatus::Acting => "acting".into(),
        AgentStatus::WaitingForUser => "waiting".into(),
        AgentStatus::Finished => "finished".into(),
        AgentStatus::MaxStepsReached => "max_steps".into(),
        AgentStatus::Error(e) => format!("error: {e}"),
    }
}

// ─── AgentInstance helpers for cloning ───────────────────────────────────

impl AgentInstance {
    /// Clone only the status-visible fields (not the Arc-backed stop signal).
    fn clone_for_status(&self) -> Self {
        Self {
            id: self.id.clone(),
            config: self.config.clone(),
            status: self.status.clone(),
            messages: vec![], // Don't clone full message history for list views
            turn_history: self.turn_history.clone(),
            step_count: self.step_count,
            total_prompt_tokens: self.total_prompt_tokens,
            total_completion_tokens: self.total_completion_tokens,
            created_at: self.created_at,
            updated_at: self.updated_at,
            stop_requested: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn agent_core_start(
    engine: State<'_, AgentEngine>,
    config: AgentConfig,
    initial_message: Option<String>,
) -> Result<StepResult, String> {
    let mut instance = AgentInstance::new(
        format!("agent-{}", engine.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst)),
        config,
    );

    if let Some(msg) = initial_message {
        instance.add_user_message(&msg);
    }

    let id = instance.id.clone();

    // Insert the instance
    let mut instances = engine.instances.lock().map_err(|e| e.to_string())?;
    instances.insert(id.clone(), instance);

    let instance = instances.get_mut(&id).ok_or("instance not found after insert")?;

    // Auto-run first step
    let runner = AgentRunner::new(engine.registry.clone());
    let status = runner.step(instance)?;

    let last_turn = instance.turn_history.last().cloned();
    Ok(StepResult {
        id,
        status: format_status(&status),
        step: instance.step_count,
        total_prompt_tokens: instance.total_prompt_tokens,
        total_completion_tokens: instance.total_completion_tokens,
        last_turn,
        error: match &status {
            AgentStatus::Error(e) => Some(e.clone()),
            _ => None,
        },
    })
}

#[tauri::command]
pub fn agent_core_step(
    engine: State<'_, AgentEngine>,
    id: String,
) -> Result<StepResult, String> {
    engine.run_step(&id)
}

#[tauri::command]
pub fn agent_core_status(
    engine: State<'_, AgentEngine>,
    id: String,
) -> Result<StepResult, String> {
    let instance = engine.get_instance(&id)?;
    let last_turn = instance.turn_history.last().cloned();
    Ok(StepResult {
        id: instance.id,
        status: format_status(&instance.status),
        step: instance.step_count,
        total_prompt_tokens: instance.total_prompt_tokens,
        total_completion_tokens: instance.total_completion_tokens,
        last_turn,
        error: match &instance.status {
            AgentStatus::Error(e) => Some(e.clone()),
            _ => None,
        },
    })
}

#[tauri::command]
pub fn agent_core_stop(
    engine: State<'_, AgentEngine>,
    id: String,
) -> Result<(), String> {
    engine.stop_session(&id)
}

#[tauri::command]
pub fn agent_core_list(
    engine: State<'_, AgentEngine>,
) -> Result<Vec<StepResult>, String> {
    let sessions = engine.list_sessions()?;
    Ok(sessions
        .into_iter()
        .map(|i| {
            let last_turn = i.turn_history.last().cloned();
            StepResult {
                id: i.id,
                status: format_status(&i.status),
                step: i.step_count,
                total_prompt_tokens: i.total_prompt_tokens,
                total_completion_tokens: i.total_completion_tokens,
                last_turn,
                error: match &i.status {
                    AgentStatus::Error(e) => Some(e.clone()),
                    _ => None,
                },
            }
        })
        .collect())
}

#[tauri::command]
pub fn agent_core_delete(
    engine: State<'_, AgentEngine>,
    id: String,
) -> Result<(), String> {
    engine.delete_session(&id)
}

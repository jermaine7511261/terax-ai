//! Harness (P0 skeleton): native agent session + event stream + command
//! surface. Model calls ride the SSRF-guarded `ai_http_stream` reqwest client
//! via `client::stream_chat_completions`; keys are read from keyring in Rust
//! and never transit the webview.

#[path = "loop.rs"]
pub mod loop_;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::modules::ai::client;
use crate::modules::secrets;

const KEYRING_SERVICE: &str = "yamet-ai";

pub struct AiSessionState {
    sessions: RwLock<HashMap<u32, Arc<AiSession>>>,
    next_id: AtomicU32,
}

impl Default for AiSessionState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionStatus {
    pub id: u32,
    pub phase: &'static str,
    pub step_count: u32,
    pub message_count: usize,
    pub aborted: bool,
}

enum SessionPhase {
    Idle,
    Running,
    Done,
    Error,
}

impl SessionPhase {
    fn label(&self) -> &'static str {
        match self {
            SessionPhase::Idle => "idle",
            SessionPhase::Running => "running",
            SessionPhase::Done => "done",
            SessionPhase::Error => "error",
        }
    }
}

pub struct AiSession {
    id: u32,
    phase: RwLock<SessionPhase>,
    step_count: AtomicU32,
    abort: AtomicBool,
    messages: RwLock<Vec<client::ChatMessage>>,
    // Wire config resolved once at open (key from keyring, never exposed).
    options: client::ChatOptions,
    model: String,
    system: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionOpenParams {
    pub base_url: String,
    pub model: String,
    /// Keyring account under the `yamet-ai` service. `None`/empty = keyless
    /// local endpoint (llama.cpp / openai-compatible).
    pub keyring_account: Option<String>,
    pub allow_private_network: bool,
    pub system: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiEvent {
    TurnStart {
        id: u32,
    },
    TextDelta {
        id: u32,
        text: String,
    },
    ReasoningDelta {
        id: u32,
        text: String,
    },
    ToolCall {
        id: u32,
        index: usize,
        tool_id: String,
        name: String,
    },
    ToolCallDelta {
        id: u32,
        index: usize,
        args: String,
    },
    Finish {
        id: u32,
        finish_reason: Option<String>,
        input_tokens: u64,
        output_tokens: u64,
        cached_input_tokens: u64,
    },
    End {
        id: u32,
    },
    Error {
        id: u32,
        message: String,
    },
}

#[tauri::command]
pub async fn ai_session_open(
    app: tauri::AppHandle,
    state: State<'_, AiSessionState>,
    params: AiSessionOpenParams,
) -> Result<u32, String> {
    let base_url = params.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("empty base url".into());
    }
    if params.model.trim().is_empty() {
        return Err("empty model id".into());
    }
    // Resolve the key entirely in Rust — the frontend only names the keyring
    // account, never the secret itself.
    let api_key = match params.keyring_account.as_deref() {
        Some(acc) if !acc.is_empty() => secrets::read_key(&app, KEYRING_SERVICE, acc)?,
        _ => None,
    };
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = Arc::new(AiSession {
        id,
        phase: RwLock::new(SessionPhase::Idle),
        step_count: AtomicU32::new(0),
        abort: AtomicBool::new(false),
        messages: RwLock::new(Vec::new()),
        options: client::ChatOptions {
            base_url,
            api_key,
            allow_private_network: params.allow_private_network,
        },
        model: params.model.trim().to_string(),
        system: params.system,
    });
    state
        .sessions
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, Arc::clone(&session));
    log::info!("ai session opened id={id}");
    Ok(id)
}

fn take_session(state: &AiSessionState, id: u32) -> Result<Arc<AiSession>, String> {
    state
        .sessions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no ai session {id}"))
}

#[tauri::command]
pub fn ai_session_close(state: State<'_, AiSessionState>, id: u32) -> Result<(), String> {
    if state
        .sessions
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id)
        .is_some()
    {
        log::info!("ai session closed id={id}");
    }
    Ok(())
}

#[tauri::command]
pub fn ai_session_abort(state: State<'_, AiSessionState>, id: u32) -> Result<(), String> {
    let s = take_session(&state, id)?;
    s.abort.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn ai_session_status(
    state: State<'_, AiSessionState>,
    id: u32,
) -> Result<AiSessionStatus, String> {
    let s = take_session(&state, id)?;
    let phase = s.phase.read().unwrap_or_else(|e| e.into_inner());
    let message_count = s
        .messages
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .len();
    Ok(AiSessionStatus {
        id,
        phase: phase.label(),
        step_count: s.step_count.load(Ordering::Acquire),
        message_count,
        aborted: s.abort.load(Ordering::Acquire),
    })
}

/// Send a user turn to the session. The turn runs on the async runtime and
/// streams `AiEvent`s over the channel; the command returns once the turn is
/// dispatched (events arrive asynchronously, mirroring the pty command shape).
#[tauri::command]
pub async fn ai_session_send(
    state: State<'_, AiSessionState>,
    id: u32,
    text: String,
    on_event: Channel<AiEvent>,
) -> Result<(), String> {
    let s = take_session(&state, id)?;
    if s
        .phase
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .label()
        == "running"
    {
        return Err("session is already running".into());
    }
    s.abort.store(false, Ordering::Release);
    *s.phase.write().unwrap_or_else(|e| e.into_inner()) = SessionPhase::Running;
    s.messages
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .push(client::ChatMessage::user(text));

    tauri::async_runtime::spawn(run_turn(Arc::clone(&s), on_event));
    Ok(())
}

async fn run_turn(session: Arc<AiSession>, on_event: Channel<AiEvent>) {
    let id = session.id;
    let _ = on_event.send(AiEvent::TurnStart { id });

    let request = build_request(&session);
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cached_input_tokens = 0u64;
    let mut finish_reason = None;

    let mut tool_slots: HashMap<usize, String> = HashMap::new();
    let outcome = client::stream_chat_completions(&session.options, &request, |ev| {
        if session.abort.load(Ordering::Acquire) {
            return Err("aborted".into());
        }
        match ev {
            client::ChatStreamEvent::ContentDelta(text) => {
                let _ = on_event.send(AiEvent::TextDelta {
                    id,
                    text: text.clone(),
                });
            }
            client::ChatStreamEvent::ReasoningDelta(text) => {
                let _ = on_event.send(AiEvent::ReasoningDelta {
                    id,
                    text: text.clone(),
                });
            }
            client::ChatStreamEvent::ToolCallStart { index, id: tool_id, name } => {
                tool_slots.insert(index, tool_id.clone());
                let _ = on_event.send(AiEvent::ToolCall {
                    id,
                    index,
                    tool_id: tool_id.clone(),
                    name: name.clone(),
                });
            }
            client::ChatStreamEvent::ToolCallDelta { index, args } => {
                let _ = on_event.send(AiEvent::ToolCallDelta { id, index, args });
            }
            client::ChatStreamEvent::Finish {
                finish_reason: fr,
                usage,
            } => {
                if let Some(fr) = fr {
                    finish_reason = Some(fr);
                }
                if let Some(u) = usage {
                    input_tokens = u.prompt_tokens.unwrap_or(0);
                    output_tokens = u.completion_tokens.unwrap_or(0);
                    cached_input_tokens = u
                        .prompt_tokens_details
                        .as_ref()
                        .and_then(|d| d.cached_tokens)
                        .unwrap_or(0);
                }
            }
        }
        Ok(())
    })
    .await;

    session.step_count.fetch_add(1, Ordering::AcqRel);

    match outcome {
        Ok(()) => {
            *session.phase.write().unwrap_or_else(|e| e.into_inner()) = SessionPhase::Done;
            let _ = on_event.send(AiEvent::Finish {
                id,
                finish_reason,
                input_tokens,
                output_tokens,
                cached_input_tokens,
            });
            let _ = on_event.send(AiEvent::End { id });
        }
        Err(_) if session.abort.load(Ordering::Acquire) => {
            // Aborted mid-turn: drop the pending user message so the next
            // send starts clean.
            session
                .messages
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .pop();
            *session.phase.write().unwrap_or_else(|e| e.into_inner()) = SessionPhase::Idle;
            let _ = on_event.send(AiEvent::Error {
                id,
                message: "aborted".into(),
            });
            let _ = on_event.send(AiEvent::End { id });
        }
        Err(e) => {
            *session.phase.write().unwrap_or_else(|e| e.into_inner()) = SessionPhase::Error;
            let _ = on_event.send(AiEvent::Error {
                id,
                message: e.clone(),
            });
            let _ = on_event.send(AiEvent::End { id });
        }
    }
}

fn build_request(session: &AiSession) -> client::ChatRequest {
    let messages = session.messages.read().unwrap_or_else(|e| e.into_inner()).clone();
    let mut full = Vec::with_capacity(messages.len() + 1);
    if let Some(system) = &session.system {
        if !system.trim().is_empty() {
            full.push(client::ChatMessage::system(system));
        }
    }
    full.extend(messages);
    client::ChatRequest {
        model: session.model.clone(),
        messages: full,
        tools: None,
        reasoning_effort: None,
        temperature: None,
        max_tokens: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_increment() {
        let st = AiSessionState::default();
        assert_eq!(st.next_id.fetch_add(1, Ordering::Relaxed), 1);
    }

    #[test]
    fn abort_flag_roundtrips() {
        let s = Arc::new(AiSession {
            id: 1,
            phase: RwLock::new(SessionPhase::Idle),
            step_count: AtomicU32::new(0),
            abort: AtomicBool::new(false),
            messages: RwLock::new(Vec::new()),
            options: client::ChatOptions {
                base_url: "http://x".into(),
                api_key: None,
                allow_private_network: true,
            },
            model: "m".into(),
            system: None,
        });
        s.abort.store(true, Ordering::Release);
        assert!(s.abort.load(Ordering::Acquire));
    }

    #[test]
    fn build_request_prepends_system_message() {
        let s = Arc::new(AiSession {
            id: 1,
            phase: RwLock::new(SessionPhase::Idle),
            step_count: AtomicU32::new(0),
            abort: AtomicBool::new(false),
            messages: RwLock::new(vec![client::ChatMessage::user("hi")]),
            options: client::ChatOptions {
                base_url: "http://x".into(),
                api_key: None,
                allow_private_network: true,
            },
            model: "m".into(),
            system: Some("sys".into()),
        });
        let req = build_request(&s);
        assert_eq!(req.messages.len(), 2);
        assert!(matches!(req.messages[0].role, client::ChatRole::System));
        assert!(matches!(req.messages[1].role, client::ChatRole::User));
    }

    #[test]
    fn build_request_skips_empty_system() {
        let s = Arc::new(AiSession {
            id: 1,
            phase: RwLock::new(SessionPhase::Idle),
            step_count: AtomicU32::new(0),
            abort: AtomicBool::new(false),
            messages: RwLock::new(vec![]),
            options: client::ChatOptions {
                base_url: "http://x".into(),
                api_key: None,
                allow_private_network: true,
            },
            model: "m".into(),
            system: Some("   ".into()),
        });
        let req = build_request(&s);
        assert!(req.messages.is_empty());
    }
}

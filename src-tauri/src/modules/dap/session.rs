//! DAP session: owns a transport to a debug adapter, runs the initialize
//! handshake, correlates request/response pairs, and forwards adapter events
//! to the frontend over a Tauri channel. The frontend drives the session
//! (launch/attach, breakpoints, stepping, inspection) through `dap_request_send`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

use super::protocol::{
    DapEvent, DapRequest, DapResponse, CMD_DISCONNECT, CMD_INITIALIZE, EVT_CONTINUED, EVT_EXITED,
    EVT_INITIALIZED, EVT_STOPPED, EVT_TERMINATED,
};
use super::transport::{DapTransport, DapTransportType, StdioDapTransport, TcpDapTransport};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const DISCONNECT_TIMEOUT: Duration = Duration::from_secs(2);

pub const EVENT_STATUS: &str = "yamet:dap-status";

#[derive(Debug, Clone, PartialEq)]
pub enum DapSessionStatus {
    Inactive,
    Initializing,
    Initialized,
    Running,
    Stopped,
    Exited,
    Error(String),
}

impl DapSessionStatus {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Inactive => "inactive",
            Self::Initializing => "initializing",
            Self::Initialized => "initialized",
            Self::Running => "running",
            Self::Stopped => "stopped",
            Self::Exited => "exited",
            Self::Error(_) => "error",
        }
    }

    pub fn message(&self) -> Option<&str> {
        match self {
            Self::Error(m) => Some(m),
            _ => None,
        }
    }
}

pub struct DapSession {
    id: String,
    app: AppHandle,
    transport: Box<dyn DapTransport>,
    seq: AtomicI32,
    pending: Mutex<HashMap<i32, mpsc::Sender<Result<DapResponse, String>>>>,
    on_event: RwLock<Option<Channel<DapEvent>>>,
    status: RwLock<DapSessionStatus>,
    capabilities: RwLock<Value>,
    closed: AtomicBool,
}

impl DapSession {
    pub fn new(id: String, app: AppHandle, transport: Box<dyn DapTransport>) -> Arc<Self> {
        let session = Arc::new(Self {
            id,
            app,
            transport,
            seq: AtomicI32::new(0),
            pending: Mutex::new(HashMap::new()),
            on_event: RwLock::new(None),
            status: RwLock::new(DapSessionStatus::Inactive),
            capabilities: RwLock::new(Value::Null),
            closed: AtomicBool::new(false),
        });
        let _ = session.spawn_reader();
        session
    }

    pub fn set_event_channel(&self, channel: Channel<DapEvent>) {
        *self.on_event.write().unwrap_or_else(|e| e.into_inner()) = Some(channel);
    }

    /// Run `initialize` and wait for the adapter to be ready. The adapter
    /// replies with capabilities and then emits `initialized`; the frontend
    /// reacts to that event by sending launch/attach.
    pub fn connect(self: &Arc<Self>) -> Result<(), String> {
        self.set_status(DapSessionStatus::Initializing);
        let params = json!({
            "clientID": "yamet",
            "clientName": "Yamet",
            "adapterID": self.id,
            "linesStartAt1": true,
            "columnsStartAt1": true,
            "pathFormat": "path",
            "supportsVariableType": true,
            "supportsVariablePaging": true,
            "supportsMemoryReferences": true,
            "supportsArgsInEnvVars": true,
        });
        let resp = self.send_request(CMD_INITIALIZE, Some(params))?;
        if !resp.success {
            let msg = resp
                .message
                .unwrap_or_else(|| "adapter rejected initialize".to_string());
            self.fail(msg.clone());
            return Err(msg);
        }
        *self.capabilities.write().unwrap_or_else(|e| e.into_inner()) = resp.body.clone().unwrap_or(Value::Null);
        self.set_status(DapSessionStatus::Initialized);
        log::info!("dap session {} initialized", self.id);
        Ok(())
    }

    pub fn send_request(
        &self,
        command: &str,
        arguments: Option<Value>,
    ) -> Result<DapResponse, String> {
        self.send_request_timeout(command, arguments, REQUEST_TIMEOUT)
    }

    fn send_request_timeout(
        &self,
        command: &str,
        arguments: Option<Value>,
        timeout: Duration,
    ) -> Result<DapResponse, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("dap session closed".to_string());
        }
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let req = DapRequest {
            seq,
            type_: "request".to_string(),
            command: command.to_string(),
            arguments,
        };
        let payload = serde_json::to_string(&req).map_err(|e| format!("dap encode failed: {e}"))?;
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).insert(seq, tx);
        if let Err(e) = self.transport.send_frame(&payload) {
            self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&seq);
            return Err(e);
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(e)) => Err(e),
            Err(_) => {
                self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&seq);
                Err(format!("dap request timed out: {command}"))
            }
        }
    }

    /// Best-effort graceful shutdown: `disconnect` with a short timeout,
    /// then tear down the transport.
    pub fn shutdown(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        let _ = self.send_request_timeout(
            CMD_DISCONNECT,
            Some(json!({"terminateDebuggee": false})),
            DISCONNECT_TIMEOUT,
        );
        self.drain_pending("session closed");
        self.transport.close();
        self.set_status(DapSessionStatus::Inactive);
        log::info!("dap session {} shutdown", self.id);
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        self.drain_pending("session closed");
        self.transport.close();
        self.set_status(DapSessionStatus::Inactive);
    }

    pub fn status(&self) -> DapSessionStatus {
        self.status.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn spawn_reader(self: &Arc<Self>) -> Result<(), String> {
        let this = self.clone();
        let id = self.id.clone();
        thread::Builder::new()
            .name(format!("yamet-dap-session-{id}"))
            .spawn(move || {
                while !this.closed.load(Ordering::Acquire) {
                    match this.transport.recv_frame() {
                        Ok(raw) => this.dispatch(&raw),
                        Err(e) => {
                            this.fail(format!("connection lost: {e}"));
                            return;
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn dispatch(&self, raw: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(raw) else {
            log::debug!("dap {}: unparsable message: {raw}", self.id);
            return;
        };
        if let Some(request_seq) = msg.get("request_seq").and_then(Value::as_i64) {
            let sender = self
                .pending
                .lock()
                .unwrap()
                .remove(&(request_seq as i32));
            let Some(sender) = sender else {
                log::debug!("dap {}: response for unknown request_seq {request_seq}", self.id);
                return;
            };
            let outcome = serde_json::from_value::<DapResponse>(msg)
                .map_err(|e| format!("malformed dap response: {e}"));
            let _ = sender.send(outcome);
        } else if let Some(event) = msg
            .get("event")
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            if let Ok(evt) = serde_json::from_value::<DapEvent>(msg) {
                self.handle_event(&event, evt);
            }
        } else {
            log::debug!("dap {}: unrecognized message: {raw}", self.id);
        }
    }

    fn handle_event(&self, name: &str, event: DapEvent) {
        match name {
            EVT_STOPPED => self.set_status(DapSessionStatus::Stopped),
            EVT_CONTINUED => self.set_status(DapSessionStatus::Running),
            EVT_EXITED | EVT_TERMINATED => {
                self.set_status(DapSessionStatus::Exited);
                // Session is over; close transport so the reader loop ends.
                self.transport.close();
                self.closed.store(true, Ordering::Release);
            }
            EVT_INITIALIZED => {
                // Adapter ready for launch/attach; surfaced to the frontend.
            }
            _ => {}
        }
        if let Some(ch) = self.on_event.read().unwrap_or_else(|e| e.into_inner()).as_ref() {
            if ch.send(event.clone()).is_err() {
                log::debug!("dap {}: event channel closed", self.id);
            }
        }
    }

    fn fail(&self, reason: String) {
        if self.status.read().unwrap_or_else(|e| e.into_inner()).kind() == "error" {
            return;
        }
        log::error!("dap session {}: {reason}", self.id);
        self.set_status(DapSessionStatus::Error(reason));
        self.drain_pending("session failed");
    }

    fn drain_pending(&self, reason: &str) {
        let pending = std::mem::take(&mut *self.pending.lock().unwrap_or_else(|e| e.into_inner()));
        for (_, tx) in pending {
            let _ = tx.send(Err(reason.to_string()));
        }
    }

    fn set_status(&self, status: DapSessionStatus) {
        let kind = status.kind().to_string();
        let message = status.message().map(str::to_string);
        *self.status.write().unwrap_or_else(|e| e.into_inner()) = status;
        let _ = self.app.emit(
            EVENT_STATUS,
            json!({ "sessionId": self.id, "status": kind, "error": message }),
        );
    }
}

// ---------------------------------------------------------------------------
// State + Tauri commands
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionConfig {
    pub id: String,
    pub adapter_type: String,
    #[serde(rename = "transport")]
    pub transport_type: DapTransportType,
    /// stdio -> adapterCommand/adapterArgs/env; tcp -> host/port; websocket -> url.
    #[serde(flatten)]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    pub id: String,
    pub adapter_type: String,
    pub transport: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct DapSessionState {
    configs: RwLock<HashMap<String, DapSessionConfig>>,
    sessions: RwLock<HashMap<String, Arc<DapSession>>>,
}

impl DapSessionState {
    fn session(&self, id: &str) -> Result<Arc<DapSession>, String> {
        self.sessions
            .read()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("dap session {id} not found"))
    }

    pub fn close_all(&self) {
        let sessions = std::mem::take(&mut *self.sessions.write().unwrap_or_else(|e| e.into_inner()));
        for (_, s) in sessions {
            s.close();
        }
    }
}

/// Register a debug adapter configuration (no connection is made).
#[tauri::command]
pub async fn dap_session_create(
    state: State<'_, DapSessionState>,
    config: DapSessionConfig,
) -> Result<(), String> {
    let mut configs = state.configs.write().unwrap_or_else(|e| e.into_inner());
    if configs.contains_key(&config.id) {
        return Err(format!("dap session with id {} already exists", config.id));
    }
    if config.adapter_type.trim().is_empty() {
        return Err("dap session adapter type is required".to_string());
    }
    match config.transport_type {
        DapTransportType::Stdio => {
            let cmd = config.config.get("adapterCommand").and_then(Value::as_str);
            if cmd.map_or(true, str::is_empty) {
                return Err("dap stdio session requires adapterCommand".to_string());
            }
        }
        DapTransportType::Tcp => {
            if config.config.get("port").and_then(Value::as_u64).is_none() {
                return Err("dap tcp session requires a port".to_string());
            }
        }
        DapTransportType::WebSocket => {
            return Err("dap websocket transport is not implemented yet".to_string());
        }
    }
    configs.insert(config.id.clone(), config);
    Ok(())
}

/// Connect a debug adapter: spawn/connect the transport, run `initialize`.
/// `onEvent` receives all adapter events (stopped, output, exited, ...).
#[tauri::command]
pub async fn dap_session_connect(
    state: State<'_, DapSessionState>,
    registry: State<'_, WorkspaceRegistry>,
    app: tauri::AppHandle,
    id: String,
    root: Option<String>,
    workspace: Option<WorkspaceEnv>,
    on_event: Channel<DapEvent>,
) -> Result<(), String> {
    let config = state
        .configs
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("dap session {id} not found"))?;
    let workspace = WorkspaceEnv::from_option(workspace);
    let cwd = authorize_spawn_cwd(&registry, root.as_deref(), &workspace)?;

    if let Some(old) = state.sessions.write().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        old.close();
    }

    let app2 = app.clone();
    let config2 = config.clone();
    let cwd2 = cwd.clone();
    let session: Arc<DapSession> = tauri::async_runtime::spawn_blocking(move || {
        let transport: Box<dyn DapTransport> = match config2.transport_type {
            DapTransportType::Stdio => {
                let adapter_command = config2
                    .config
                    .get("adapterCommand")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "dap stdio session missing adapterCommand".to_string())?
                    .to_string();
                let adapter_args = config2
                    .config
                    .get("adapterArgs")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let env = parse_env_pairs(config2.config.get("env"));
                Box::new(StdioDapTransport::spawn(
                    &adapter_command,
                    &adapter_args,
                    &env,
                    cwd2.as_deref(),
                )?)
            }
            DapTransportType::Tcp => {
                let host = config2
                    .config
                    .get("host")
                    .and_then(Value::as_str)
                    .unwrap_or("127.0.0.1")
                    .to_string();
                let port = config2
                    .config
                    .get("port")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "dap tcp session missing port".to_string())? as u16;
                Box::new(TcpDapTransport::connect(&host, port)?)
            }
            DapTransportType::WebSocket => {
                return Err("dap websocket transport is not implemented yet".to_string());
            }
        };
        let session = DapSession::new(config2.id.clone(), app2, transport);
        session.set_event_channel(on_event);
        session.connect()?;
        Ok::<_, String>(session)
    })
    .await
    .map_err(|e| e.to_string())??;

    state.sessions.write().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), session);
    log::info!("dap session {id} connected");
    Ok(())
}

/// Send any DAP request (launch, attach, setBreakpoints, threads, stackTrace,
/// scopes, variables, continue, next, stepIn, ...) and await the adapter's
/// response. `success: false` responses come back as Ok with the message.
#[tauri::command]
pub async fn dap_request_send(
    state: State<'_, DapSessionState>,
    session_id: String,
    command: String,
    arguments: Option<Value>,
) -> Result<DapResponse, String> {
    let session = state.session(&session_id)?;
    session.send_request(&command, arguments)
}

/// Disconnect a debug session (graceful).
#[tauri::command]
pub async fn dap_session_disconnect(
    state: State<'_, DapSessionState>,
    id: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .write()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| format!("dap session {id} is not connected"))?;
    session.shutdown();
    Ok(())
}

#[tauri::command]
pub fn dap_session_list(state: State<'_, DapSessionState>) -> Vec<DapSessionInfo> {
    let configs: Vec<DapSessionConfig> = state.configs.read().unwrap_or_else(|e| e.into_inner()).values().cloned().collect();
    configs
        .iter()
        .map(|c| {
            let session = state.sessions.read().unwrap_or_else(|e| e.into_inner()).get(&c.id).cloned();
            let (status, error) = match session {
                Some(s) => {
                    let st = s.status();
                    (st.kind().to_string(), st.message().map(str::to_string))
                }
                None => ("inactive".to_string(), None),
            };
            DapSessionInfo {
                id: c.id.clone(),
                adapter_type: c.adapter_type.clone(),
                transport: match c.transport_type {
                    DapTransportType::Stdio => "stdio".to_string(),
                    DapTransportType::WebSocket => "websocket".to_string(),
                    DapTransportType::Tcp => "tcp".to_string(),
                },
                status,
                error,
            }
        })
        .collect()
}

#[tauri::command]
pub fn dap_session_get(
    state: State<'_, DapSessionState>,
    id: String,
) -> Option<DapSessionInfo> {
    let config = state.configs.read().unwrap_or_else(|e| e.into_inner()).get(&id).cloned()?;
    let session = state.sessions.read().unwrap_or_else(|e| e.into_inner()).get(&id).cloned();
    let (status, error) = match session {
        Some(s) => {
            let st = s.status();
            (st.kind().to_string(), st.message().map(str::to_string))
        }
        None => ("inactive".to_string(), None),
    };
    Some(DapSessionInfo {
        id: config.id.clone(),
        adapter_type: config.adapter_type.clone(),
        transport: match config.transport_type {
            DapTransportType::Stdio => "stdio".to_string(),
            DapTransportType::WebSocket => "websocket".to_string(),
            DapTransportType::Tcp => "tcp".to_string(),
        },
        status,
        error,
    })
}

fn parse_env_pairs(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let name = v.get("name")?.as_str()?;
                    let value = v.get("value").and_then(Value::as_str).unwrap_or("");
                    Some((name.to_string(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

//! Debug Adapter Protocol (DAP) debugger support.
//!
//! Spawns debug adapters as subprocesses and speaks DAP (JSON-RPC +
//! Content-Length framing) over stdio, reusing `lsp::framing`. The frontend
//! drives everything through a small command surface:
//!
//!   - `dap_launch(config)`   select adapter, spawn, initialize + launch
//!   - `dap_attach(config)`   select adapter, spawn, initialize + attach
//!   - `dap_send(id, message)` arbitrary JSON-RPC to the adapter
//!   - `dap_kill(id)`         terminate a session
//!   - `dap_list()`           running sessions
//!
//! Inbound adapter messages (events, responses, reverse requests) stream to
//! the frontend over a `Channel`. Protocol intelligence lives on the frontend
//! (`src/modules/debug/`), mirroring the LSP split.

mod adapter;
mod session;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

use serde::Deserialize;
use tauri::ipc::{Channel, Response};

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
use session::DapSession;

/// A launch/attach configuration from `.yamet/launch.json` (or settings).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DapLaunchConfig {
    /// Program to debug (path). Used to select the adapter by extension.
    pub program: String,
    /// Workspace root (cwd for the adapter process).
    pub cwd: Option<String>,
    /// Explicit adapter id; when absent, selected by extension.
    pub adapter: Option<String>,
    /// Request args (`launch`/`attach` DAP body).
    #[serde(default)]
    pub args: serde_json::Value,
    /// For attach: host/port/pid to attach to.
    #[serde(default)]
    pub attach: bool,
    /// Environment overrides passed to the adapter process.
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// Snapshot of a running session for `dap_list`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    pub id: u32,
    pub adapter: String,
    pub program: String,
}

pub struct DapState {
    sessions: RwLock<HashMap<u32, Arc<DapSession>>>,
    meta: RwLock<HashMap<u32, (String, String)>>, // id -> (adapter, program)
    next_id: AtomicU32,
}

impl Default for DapState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            meta: RwLock::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl DapState {
    fn take(&self, id: u32) -> Option<Arc<DapSession>> {
        self.meta.write().unwrap_or_else(|e| e.into_inner()).remove(&id);
        self.sessions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id)
    }

    pub fn kill_all(&self) {
        let drained: Vec<Arc<DapSession>> = self
            .sessions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
            .map(|(_, s)| s)
            .collect();
        self.meta.write().unwrap_or_else(|e| e.into_inner()).clear();
        for session in drained {
            session.kill();
        }
    }
}

fn resolve_adapter_cmd(config: &DapLaunchConfig, root: &std::path::Path) -> Result<(String, Vec<String>), String> {
    let ext = config
        .program
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let def = if let Some(id) = &config.adapter {
        adapter::adapter_by_id(id).ok_or_else(|| format!("dap: unknown adapter '{id}'"))?
    } else {
        adapter::select_adapter(&ext, Some(root)).ok_or_else(|| {
            format!("dap: no adapter for '.{ext}' (install debugpy/node-inspect, or set an adapter)")
        })?
    };
    Ok((def.command.to_string(), def.args.iter().map(|s| s.to_string()).collect()))
}

#[tauri::command]
pub async fn dap_launch(
    state: tauri::State<'_, DapState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    config: DapLaunchConfig,
    on_inbound: Channel<Response>,
    on_exit: Channel<session::DapExit>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(None);
    let cwd = authorize_spawn_cwd(&registry, config.cwd.as_deref(), &workspace)?
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let (command, base_args) = resolve_adapter_cmd(&config, &cwd)?;
    let adapter_id = config
        .adapter
        .clone()
        .unwrap_or_else(|| {
            let ext = config.program.rsplit('.').next().unwrap_or("");
            adapter::select_adapter(ext, Some(&cwd))
                .map(|d| d.id.to_string())
                .unwrap_or_else(|| command.clone())
        });
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    // node-inspect needs the program appended to its launcher args.
    let mut args = base_args.clone();
    if adapter_id == "node-inspect" {
        args.push(config.program.clone());
    }
    let program = config.program.clone();

    let session = tauri::async_runtime::spawn_blocking(move || {
        session::spawn(id, &command, &args, &cwd, on_inbound, on_exit)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Handshake: initialize -> then launch/attach. Failures tear down.
    let init = session.request(
        "initialize",
        serde_json::json!({
            "clientID": "yamet",
            "adapterID": adapter_id,
            "supportsVariableType": true,
            "supportsEvaluateForHovers": true,
            "supportsConfigurationDoneRequest": true,
            "supportsFunctionBreakpoints": false,
            "supportsConditionalBreakpoints": false,
            "supportsHitConditionalBreakpoints": false,
            "supportsEvaluateForHovers": true,
            "supportsSetVariable": true,
            "supportsExceptionInfoRequest": true,
        }),
    );
    if let Err(e) = init {
        session.kill();
        return Err(e);
    }
    let method = if config.attach { "attach" } else { "launch" };
    let launch_args = if config.args.is_null() {
        serde_json::json!({})
    } else {
        config.args.clone()
    };
    // Send launch/attach but do NOT wait for its response: debugpy (and most
    // adapters) defer the launch response until `configurationDone`, which
    // the frontend sends only after the `initialized` event. Blocking here
    // would deadlock the flow. Fire-and-forget; a later error surfaces as an
    // orphaned response forwarded to the frontend.
    {
        session.send_request(method, launch_args);
    }

    state
        .sessions
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, session.clone());
    state
        .meta
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, (adapter_id.clone(), program));
    // Reap if the adapter died during handshake.
    if session.exited.load(Ordering::Acquire) {
        state.take(id);
    }
    log::info!("dap spawned id={id} adapter={adapter_id}");
    Ok(id)
}

#[tauri::command]
pub async fn dap_attach(
    state: tauri::State<'_, DapState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    config: DapLaunchConfig,
    on_inbound: Channel<Response>,
    on_exit: Channel<session::DapExit>,
) -> Result<u32, String> {
    let mut cfg = config;
    cfg.attach = true;
    dap_launch(state, registry, cfg, on_inbound, on_exit).await
}

#[tauri::command]
pub async fn dap_send(
    state: tauri::State<'_, DapState>,
    id: u32,
    message: serde_json::Value,
) -> Result<(), String> {
    let session = state
        .sessions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("dap_send: unknown id={id}"))?;
    tauri::async_runtime::spawn_blocking(move || session.write(&message))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dap_kill(state: tauri::State<'_, DapState>, id: u32) {
    if let Some(session) = state.take(id) {
        session.kill();
        log::info!("dap killed id={id}");
    }
}

#[tauri::command]
pub fn dap_list(state: tauri::State<'_, DapState>) -> Vec<DapSessionInfo> {
    let meta = state.meta.read().unwrap_or_else(|e| e.into_inner());
    state
        .sessions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .keys()
        .map(|id| {
            let (adapter, program) = meta.get(id).cloned().unwrap_or_default();
            DapSessionInfo {
                id: *id,
                adapter,
                program,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_selects_debugpy() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join("app.py"), "").unwrap();
        let cfg = DapLaunchConfig {
            program: "app.py".to_string(),
            cwd: Some(tmp.path().to_string_lossy().into_owned()),
            adapter: None,
            args: serde_json::Value::Null,
            attach: false,
            env: HashMap::new(),
        };
        let (cmd, _args) = resolve_adapter_cmd(&cfg, tmp.path()).expect("resolve");
        assert_eq!(cmd, "python");
    }

    #[test]
    fn resolve_explicit_adapter_overrides() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = DapLaunchConfig {
            program: "app.go".to_string(),
            cwd: Some(tmp.path().to_string_lossy().into_owned()),
            adapter: Some("debugpy".to_string()),
            args: serde_json::Value::Null,
            attach: false,
            env: HashMap::new(),
        };
        let (cmd, _args) = resolve_adapter_cmd(&cfg, tmp.path()).expect("resolve");
        assert_eq!(cmd, "python");
    }

    #[test]
    fn unknown_adapter_errors() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = DapLaunchConfig {
            program: "a.py".to_string(),
            cwd: Some(tmp.path().to_string_lossy().into_owned()),
            adapter: Some("nope".to_string()),
            args: serde_json::Value::Null,
            attach: false,
            env: HashMap::new(),
        };
        assert!(resolve_adapter_cmd(&cfg, tmp.path()).is_err());
    }
}

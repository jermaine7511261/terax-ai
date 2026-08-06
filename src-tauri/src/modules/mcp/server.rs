//! MCP server registry: configured servers (definition only) vs live sessions
//! (spawned/connected transport + handshake done). Tauri commands below are
//! the native IPC surface the frontend drives.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::State;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

use super::session::{McpPromptInfo, McpResourceInfo, McpSession, McpToolInfo};
use super::transport::{McpTransport, McpTransportType, SseTransport, StdioTransport};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    /// `stdio` | `sse`
    #[serde(rename = "transport")]
    pub transport_type: McpTransportType,
    /// Transport-specific fields, flattened from the payload:
    /// stdio -> command/args/env; sse -> url/headers.
    #[serde(flatten)]
    pub config: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub status: String,
    pub error: Option<String>,
    pub tools: Vec<McpToolInfo>,
    pub resources: Vec<McpResourceInfo>,
    pub prompts: Vec<McpPromptInfo>,
}

#[derive(Default)]
pub struct McpServerState {
    configs: RwLock<HashMap<String, McpServerConfig>>,
    sessions: RwLock<HashMap<String, Arc<McpSession>>>,
}

impl McpServerState {
    pub fn shutdown_all(&self) {
        let sessions = std::mem::take(&mut *self.sessions.write().unwrap());
        for (_, s) in sessions {
            s.shutdown();
        }
    }

    fn session(&self, id: &str) -> Result<Arc<McpSession>, String> {
        self.sessions
            .read()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("mcp server {id} is not connected"))
    }

    fn info_for(&self, config: &McpServerConfig) -> McpServerInfo {
        let session = self.sessions.read().unwrap().get(&config.id).cloned();
        let (status, error, tools, resources, prompts) = match session {
            Some(s) => {
                let st = s.status();
                (
                    st.kind().to_string(),
                    st.message().map(str::to_string),
                    s.tools(),
                    s.resources(),
                    s.prompts(),
                )
            }
            None => (
                "disconnected".to_string(),
                None,
                Vec::new(),
                Vec::new(),
                Vec::new(),
            ),
        };
        McpServerInfo {
            id: config.id.clone(),
            name: config.name.clone(),
            transport: match config.transport_type {
                McpTransportType::Stdio => "stdio".to_string(),
                McpTransportType::Sse => "sse".to_string(),
            },
            status,
            error,
            tools,
            resources,
            prompts,
        }
    }
}

/// Register an MCP server definition (no connection is made).
#[tauri::command]
pub async fn mcp_server_add(
    state: State<'_, McpServerState>,
    config: McpServerConfig,
) -> Result<(), String> {
    let mut configs = state.configs.write().unwrap();
    if configs.contains_key(&config.id) {
        return Err(format!("mcp server with id {} already exists", config.id));
    }
    if config.name.trim().is_empty() {
        return Err("mcp server name is required".to_string());
    }
    match config.transport_type {
        McpTransportType::Stdio => {
            let cmd = config.config.get("command").and_then(Value::as_str);
            if cmd.map_or(true, str::is_empty) {
                return Err("mcp stdio server requires a command".to_string());
            }
        }
        McpTransportType::Sse => {
            let url = config.config.get("url").and_then(Value::as_str);
            if url.map_or(true, str::is_empty) {
                return Err("mcp sse server requires a url".to_string());
            }
        }
    }
    configs.insert(config.id.clone(), config);
    Ok(())
}

/// Remove a configured server; disconnects it first if connected.
#[tauri::command]
pub async fn mcp_server_remove(state: State<'_, McpServerState>, id: String) -> Result<(), String> {
    if let Some(s) = state.sessions.write().unwrap().remove(&id) {
        s.close();
    }
    let mut configs = state.configs.write().unwrap();
    if configs.remove(&id).is_none() {
        return Err(format!("mcp server {id} not found"));
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_server_list(state: State<'_, McpServerState>) -> Vec<McpServerInfo> {
    let configs: Vec<McpServerConfig> = state
        .configs
        .read()
        .unwrap()
        .values()
        .cloned()
        .collect();
    configs.iter().map(|c| state.info_for(c)).collect()
}

#[tauri::command]
pub fn mcp_server_get(state: State<'_, McpServerState>, id: String) -> Option<McpServerInfo> {
    let config = state.configs.read().unwrap().get(&id).cloned()?;
    Some(state.info_for(&config))
}

/// Connect a configured server: spawn/connect the transport, run the
/// initialize handshake, prefetch capabilities. `root` is the workspace
/// directory the stdio child runs in (authorized against the registry).
#[tauri::command]
pub async fn mcp_server_connect(
    state: State<'_, McpServerState>,
    registry: State<'_, WorkspaceRegistry>,
    app: tauri::AppHandle,
    id: String,
    root: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<(), String> {
    let config = state
        .configs
        .read()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("mcp server {id} not found"))?;
    let workspace = WorkspaceEnv::from_option(workspace);
    let cwd = authorize_spawn_cwd(&registry, root.as_deref(), &workspace)?;

    // Replace any existing session for this server.
    if let Some(old) = state.sessions.write().unwrap().remove(&id) {
        old.close();
    }

    let app2 = app.clone();
    let config2 = config.clone();
    let cwd2 = cwd.clone();
    let session: Arc<McpSession> = tauri::async_runtime::spawn_blocking(move || {
        let transport: Box<dyn McpTransport> = match config2.transport_type {
            McpTransportType::Stdio => {
                let command = config2
                    .config
                    .get("command")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "mcp stdio server missing command".to_string())?
                    .to_string();
                let args = config2
                    .config
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let env = parse_env_pairs(config2.config.get("env"));
                Box::new(StdioTransport::spawn(&command, &args, &env, cwd2.as_deref())?)
            }
            McpTransportType::Sse => {
                let url = config2
                    .config
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "mcp sse server missing url".to_string())?
                    .to_string();
                let headers = parse_env_pairs(config2.config.get("headers"));
                Box::new(SseTransport::connect(&url, &headers)?)
            }
        };
        let session = McpSession::new(config2.id.clone(), app2, transport);
        session.connect()?;
        Ok::<_, String>(session)
    })
    .await
    .map_err(|e| e.to_string())??;

    state.sessions.write().unwrap().insert(id.clone(), session);
    log::info!("mcp server {id} connected");
    Ok(())
}

/// Disconnect a connected server (graceful shutdown).
#[tauri::command]
pub async fn mcp_server_disconnect(
    state: State<'_, McpServerState>,
    id: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .write()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| format!("mcp server {id} is not connected"))?;
    session.shutdown();
    Ok(())
}

/// Re-run tools/list (and resources/prompts) on a connected server.
#[tauri::command]
pub async fn mcp_server_refresh(
    state: State<'_, McpServerState>,
    id: String,
) -> Result<usize, String> {
    let session = state.session(&id)?;
    let n = session.refresh_tools()?;
    let _ = session.refresh_resources();
    let _ = session.refresh_prompts();
    Ok(n)
}

/// Execute a tool on a connected MCP server. Result is the raw
/// `tools/call` result (content parts + optional isError).
#[tauri::command]
pub async fn mcp_tool_call(
    state: State<'_, McpServerState>,
    id: String,
    name: String,
    arguments: Value,
) -> Result<Value, String> {
    let session = state.session(&id)?;
    session.call_tool(&name, arguments)
}

#[tauri::command]
pub async fn mcp_resource_read(
    state: State<'_, McpServerState>,
    id: String,
    uri: String,
) -> Result<Value, String> {
    let session = state.session(&id)?;
    session.read_resource(&uri)
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

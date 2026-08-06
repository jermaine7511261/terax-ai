//! MCP session: owns a transport, drives the JSON-RPC handshake, correlates
//! requests with responses, and caches server capabilities (tools, resources,
//! prompts) for the AI tool surface.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::protocol::{
    notification, request, ERR_INTERNAL, ERR_METHOD_NOT_FOUND, METHOD_INITIALIZE, METHOD_PING,
    METHOD_PROMPTS_GET, METHOD_PROMPTS_LIST, METHOD_RESOURCES_LIST, METHOD_RESOURCES_READ,
    METHOD_SHUTDOWN, METHOD_TOOLS_CALL, METHOD_TOOLS_LIST, NOTIFY_EXIT, NOTIFY_INITIALIZED,
    PROTOCOL_VERSION, RpcError, RpcResponse,
};
use super::transport::McpTransport;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const ENDPOINT_READY_TIMEOUT: Duration = Duration::from_secs(10);

pub const EVENT_STATUS: &str = "yamet:mcp-status";
pub const EVENT_LOG: &str = "yamet:mcp-log";

#[derive(Debug, Clone, Serialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpResourceInfo {
    pub uri: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpPromptInfo {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum McpSessionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

impl McpSessionStatus {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Disconnected => "disconnected",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
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

pub struct McpSession {
    server_id: String,
    app: AppHandle,
    transport: Box<dyn McpTransport>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, RpcError>>>>,
    status: RwLock<McpSessionStatus>,
    tools: RwLock<Vec<McpToolInfo>>,
    resources: RwLock<Vec<McpResourceInfo>>,
    prompts: RwLock<Vec<McpPromptInfo>>,
    capabilities: RwLock<Value>,
    closed: AtomicBool,
}

impl McpSession {
    /// Build a session over an already-constructed transport and start the
    /// reader thread. Call `connect` afterwards to run the handshake.
    pub fn new(server_id: String, app: AppHandle, transport: Box<dyn McpTransport>) -> Arc<Self> {
        let session = Arc::new(Self {
            server_id,
            app,
            transport,
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            status: RwLock::new(McpSessionStatus::Disconnected),
            tools: RwLock::new(Vec::new()),
            resources: RwLock::new(Vec::new()),
            prompts: RwLock::new(Vec::new()),
            capabilities: RwLock::new(Value::Null),
            closed: AtomicBool::new(false),
        });
        let _ = session.spawn_reader();
        session
    }

    // -- lifecycle ----------------------------------------------------------

    /// Run the MCP initialize handshake and prefetch capabilities.
    pub fn connect(self: &Arc<Self>) -> Result<(), String> {
        self.set_status(McpSessionStatus::Connecting);
        self.transport
            .wait_ready(ENDPOINT_READY_TIMEOUT)
            .map_err(|e| {
                self.fail(format!("mcp {e}"));
                e
            })?;
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "yamet", "version": env!("CARGO_PKG_VERSION") },
        });
        let result = match self.request(METHOD_INITIALIZE, Some(params)) {
            Ok(r) => r,
            Err(e) => {
                self.fail(format!("initialize failed: {e}"));
                return Err(e);
            }
        };
        *self.capabilities.write().unwrap_or_else(|e| e.into_inner()) =
            result.get("capabilities").cloned().unwrap_or(Value::Null);
        self.notify(NOTIFY_INITIALIZED, None)?;
        self.set_status(McpSessionStatus::Connected);
        // Capability prefetch is best-effort; a server that errors on one
        // list must not take the whole session down.
        let _ = self.refresh_tools();
        let _ = self.refresh_resources();
        let _ = self.refresh_prompts();
        Ok(())
    }

    /// Graceful shutdown: `shutdown` request (short timeout), `exit`
    /// notification, then close the transport.
    pub fn shutdown(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        let _ = self.send_request_timeout(METHOD_SHUTDOWN, None, SHUTDOWN_TIMEOUT);
        let _ = self.notify(NOTIFY_EXIT, None);
        self.drain_pending("session closed");
        self.transport.close();
        self.set_status(McpSessionStatus::Disconnected);
        log::info!("mcp session {} shutdown", self.server_id);
    }

    /// Hard close without the handshake (call on failures too).
    pub fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        self.drain_pending("session closed");
        self.transport.close();
        self.set_status(McpSessionStatus::Disconnected);
    }

    pub fn status(&self) -> McpSessionStatus {
        self.status.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    // -- capability access --------------------------------------------------

    pub fn tools(&self) -> Vec<McpToolInfo> {
        self.tools.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn resources(&self) -> Vec<McpResourceInfo> {
        self.resources.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn prompts(&self) -> Vec<McpPromptInfo> {
        self.prompts.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn refresh_tools(&self) -> Result<usize, String> {
        let result = self.request(METHOD_TOOLS_LIST, None)?;
        let list = result
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let tools: Vec<McpToolInfo> = list
            .into_iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?.to_string();
                Some(McpToolInfo {
                    name,
                    description: t
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    input_schema: t.get("inputSchema").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        let count = tools.len();
        *self.tools.write().unwrap_or_else(|e| e.into_inner()) = tools;
        Ok(count)
    }

    pub fn refresh_resources(&self) -> Result<usize, String> {
        let result = self.request(METHOD_RESOURCES_LIST, None)?;
        let list = result
            .get("resources")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let resources: Vec<McpResourceInfo> = list
            .into_iter()
            .filter_map(|r| {
                let uri = r.get("uri")?.as_str()?.to_string();
                Some(McpResourceInfo {
                    uri,
                    name: r
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    description: r
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect();
        let count = resources.len();
        *self.resources.write().unwrap_or_else(|e| e.into_inner()) = resources;
        Ok(count)
    }

    pub fn refresh_prompts(&self) -> Result<usize, String> {
        let result = self.request(METHOD_PROMPTS_LIST, None)?;
        let list = result
            .get("prompts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let prompts: Vec<McpPromptInfo> = list
            .into_iter()
            .filter_map(|p| {
                let name = p.get("name")?.as_str()?.to_string();
                Some(McpPromptInfo {
                    name,
                    description: p
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect();
        let count = prompts.len();
        *self.prompts.write().unwrap_or_else(|e| e.into_inner()) = prompts;
        Ok(count)
    }

    // -- operations ---------------------------------------------------------

    pub fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        let params = json!({ "name": name, "arguments": arguments });
        self.request(METHOD_TOOLS_CALL, Some(params))
    }

    pub fn read_resource(&self, uri: &str) -> Result<Value, String> {
        let params = json!({ "uri": uri });
        self.request(METHOD_RESOURCES_READ, Some(params))
    }

    pub fn get_prompt(&self, name: &str, arguments: Value) -> Result<Value, String> {
        let params = json!({ "name": name, "arguments": arguments });
        self.request(METHOD_PROMPTS_GET, Some(params))
    }

    pub fn ping(&self) -> Result<(), String> {
        self.request(METHOD_PING, None).map(|_| ())
    }

    // -- plumbing -----------------------------------------------------------

    fn request(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        self.send_request_timeout(method, params, REQUEST_TIMEOUT)
    }

    fn send_request_timeout(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("mcp session closed".to_string());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let payload = serde_json::to_string(&request(Value::from(id), method, params))
            .map_err(|e| format!("mcp encode failed: {e}"))?;
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
        if let Err(e) = self.transport.send(&payload) {
            self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            return Err(e);
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(rpc_err)) => Err(rpc_err.to_string()),
            Err(_) => {
                self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                Err(format!("mcp request timed out: {method}"))
            }
        }
    }

    fn notify(&self, method: &str, params: Option<Value>) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("mcp session closed".to_string());
        }
        let payload = serde_json::to_string(&notification(method, params))
            .map_err(|e| e.to_string())?;
        self.transport.send(&payload)
    }

    fn spawn_reader(self: &Arc<Self>) -> Result<(), String> {
        let this = self.clone();
        let server_id = self.server_id.clone();
        thread::Builder::new()
            .name(format!("yamet-mcp-session-{server_id}"))
            .spawn(move || {
                while !this.closed.load(Ordering::Acquire) {
                    match this.transport.recv() {
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
            log::debug!("mcp {}: unparsable message: {raw}", self.server_id);
            return;
        };
        if msg.get("id").is_some() {
            // Response to one of our requests.
            let Some(id) = msg.get("id").and_then(Value::as_u64) else {
                log::debug!("mcp {}: response with non-numeric id", self.server_id);
                return;
            };
            let sender = self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
            let Some(sender) = sender else {
                log::debug!("mcp {}: response for unknown id {id}", self.server_id);
                return;
            };
            let outcome = match serde_json::from_value::<RpcResponse>(msg) {
                Ok(resp) => match resp.error {
                    Some(err) => Err(err),
                    None => Ok(resp.result.unwrap_or(Value::Null)),
                },
                Err(e) => Err(RpcError {
                    code: ERR_INTERNAL,
                    message: format!("malformed response: {e}"),
                    data: None,
                }),
            };
            let _ = sender.send(outcome);
        } else if let Some(method) = msg.get("method").and_then(Value::as_str).map(str::to_string) {
            // Server-to-client message: request or notification.
            if msg.get("id").is_some() {
                let id = msg.get("id").cloned().unwrap_or(Value::Null);
                let reply = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": ERR_METHOD_NOT_FOUND, "message": format!("unhandled method {method}") },
                });
                let _ = self.transport.send(&reply.to_string());
            } else {
                self.handle_server_notification(&method, msg.get("params").cloned());
            }
        } else {
            log::debug!("mcp {}: unrecognized message: {raw}", self.server_id);
        }
    }

    fn handle_server_notification(&self, method: &str, params: Option<Value>) {
        match method {
            "logging/message" => {
                if let Some(level) = params
                    .as_ref()
                    .and_then(|p| p.get("level"))
                    .and_then(Value::as_str)
                {
                    let text = params
                        .as_ref()
                        .and_then(|p| p.get("data"))
                        .map(|d| d.to_string())
                        .unwrap_or_default();
                    let _ = self.app.emit(
                        EVENT_LOG,
                        json!({ "serverId": self.server_id, "level": level, "message": text }),
                    );
                }
            }
            "notifications/message" | "notifications/progress" => {
                log::debug!("mcp {}: {method}", self.server_id);
            }
            _ => log::debug!("mcp {}: unhandled server notification {method}", self.server_id),
        }
    }

    fn fail(&self, reason: String) {
        if self.status.read().unwrap_or_else(|e| e.into_inner()).kind() == "error" {
            return;
        }
        log::error!("mcp session {}: {reason}", self.server_id);
        self.set_status(McpSessionStatus::Error(reason));
        self.drain_pending("session failed");
    }

    fn drain_pending(&self, reason: &str) {
        let pending = std::mem::take(&mut *self.pending.lock().unwrap_or_else(|e| e.into_inner()));
        for (_, tx) in pending {
            let _ = tx.send(Err(RpcError {
                code: ERR_INTERNAL,
                message: reason.to_string(),
                data: None,
            }));
        }
    }

    fn set_status(&self, status: McpSessionStatus) {
        let kind = status.kind().to_string();
        let message = status.message().map(str::to_string);
        *self.status.write().unwrap_or_else(|e| e.into_inner()) = status;
        let _ = self.app.emit(
            EVENT_STATUS,
            json!({ "serverId": self.server_id, "status": kind, "error": message }),
        );
    }
}

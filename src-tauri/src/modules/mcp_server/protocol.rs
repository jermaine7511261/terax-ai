//! MCP server-side JSON-RPC 2.0 protocol (stdio, newline-delimited).
//!
//! Mirrors the wire format expected by MCP clients (Claude Code, OpenCode, etc.):
//! - Requests: `{"jsonrpc":"2.0","id":...,"method":"...","params":{...}}\n`
//! - Responses: `{"jsonrpc":"2.0","id":...,"result":{...}}\n` or `{"jsonrpc":"2.0","id":...,"error":{...}}\n`
//! - Notifications (no id): `{"jsonrpc":"2.0","method":"...","params":{...}}\n`

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Incoming requests / notifications
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "method")]
pub enum ServerRequest {
    /// First message from the client; must be answered before anything else.
    #[serde(rename = "initialize")]
    Initialize {
        #[serde(default)]
        params: InitializeParams,
    },

    /// Client acknowledges the server is ready (notification, no id).
    #[serde(rename = "notifications/initialized")]
    Initialized,

    /// List available tools.
    #[serde(rename = "tools/list")]
    ToolsList {
        #[serde(default)]
        id: serde_json::Value,
    },

    /// Invoke a tool.
    #[serde(rename = "tools/call")]
    ToolsCall {
        id: serde_json::Value,
        params: ToolsCallParams,
    },

    /// Liveness ping.
    #[serde(rename = "ping")]
    Ping {
        #[serde(default)]
        id: serde_json::Value,
    },
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct InitializeParams {
    #[serde(default)]
    pub protocol_version: String,
    #[serde(default)]
    pub capabilities: serde_json::Value,
    #[serde(default)]
    pub client_info: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolsCallParams {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Outgoing responses
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcResponse {
    pub fn success(id: serde_json::Value, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: serde_json::Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

// ---------------------------------------------------------------------------
// Notification (server → client, no id)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: &'static str,
    pub method: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

impl JsonRpcNotification {
    pub fn new(method: &'static str, params: Option<serde_json::Value>) -> Self {
        Self {
            jsonrpc: "2.0",
            method,
            params,
        }
    }
}

// ---------------------------------------------------------------------------
// Tool schema helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Protocol parsing
// ---------------------------------------------------------------------------

/// Parse a single JSON-RPC line. Returns `None` for empty/whitespace-only lines.
pub fn parse_request(line: &str) -> Result<Option<ServerRequest>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str(trimmed).map(Some).map_err(|e| e.to_string())
}

/// Serialize a response to a JSON line.
pub fn serialize_response(resp: &JsonRpcResponse) -> String {
    serde_json::to_string(resp).unwrap_or_default()
}

/// Serialize a notification to a JSON line.
pub fn serialize_notification(notif: &JsonRpcNotification) -> String {
    serde_json::to_string(notif).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_initialize_request() {
        let line = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
        let req = parse_request(line).unwrap().unwrap();
        match req {
            ServerRequest::Initialize { .. } => {}
            _ => panic!("expected Initialize"),
        }
    }

    #[test]
    fn parse_tools_list() {
        let line = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;
        let req = parse_request(line).unwrap().unwrap();
        match req {
            ServerRequest::ToolsList { id } => assert_eq!(id, 2),
            _ => panic!("expected ToolsList"),
        }
    }

    #[test]
    fn parse_empty_line() {
        assert!(parse_request("").unwrap().is_none());
        assert!(parse_request("  \n").unwrap().is_none());
    }

    #[test]
    fn serialize_success_response() {
        let resp = JsonRpcResponse::success(
            serde_json::json!(1),
            serde_json::json!({"tools": []}),
        );
        let s = serialize_response(&resp);
        assert!(s.contains("\"result\""));
        assert!(s.contains("\"tools\""));
    }

    #[test]
    fn serialize_error_response() {
        let resp = JsonRpcResponse::error(serde_json::json!(1), -32600, "Invalid Request");
        let s = serialize_response(&resp);
        assert!(s.contains("\"error\""));
        assert!(s.contains("Invalid Request"));
    }
}

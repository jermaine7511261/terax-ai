//! MCP (Model Context Protocol) JSON-RPC message types and method constants.
//! Wire protocol per https://modelcontextprotocol.io/specification/2025-06-18.
//! Transport framing lives in `transport.rs` (stdio = newline-delimited JSON,
//! SSE = Server-Sent Events over HTTP); this file only models the messages.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const JSONRPC_VERSION: &str = "2.0";

// Requests the client sends.
pub const METHOD_INITIALIZE: &str = "initialize";
pub const METHOD_PING: &str = "ping";
pub const METHOD_TOOLS_LIST: &str = "tools/list";
pub const METHOD_TOOLS_CALL: &str = "tools/call";
pub const METHOD_RESOURCES_LIST: &str = "resources/list";
pub const METHOD_RESOURCES_READ: &str = "resources/read";
pub const METHOD_PROMPTS_LIST: &str = "prompts/list";
pub const METHOD_PROMPTS_GET: &str = "prompts/get";
pub const METHOD_SHUTDOWN: &str = "shutdown";

// Notifications the client sends.
pub const NOTIFY_INITIALIZED: &str = "notifications/initialized";
pub const NOTIFY_CANCELLED: &str = "notifications/cancelled";
pub const NOTIFY_EXIT: &str = "exit";

// JSON-RPC error codes.
pub const ERR_PARSE: i64 = -32700;
pub const ERR_INVALID_REQUEST: i64 = -32600;
pub const ERR_METHOD_NOT_FOUND: i64 = -32601;
pub const ERR_INVALID_PARAMS: i64 = -32602;
pub const ERR_INTERNAL: i64 = -32603;
// MCP-specific range for protocol-level errors.
pub const ERR_INVALID_REQUEST_PARAMS: i64 = -32602;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(rename = "method")]
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcNotification {
    pub jsonrpc: String,
    #[serde(rename = "method")]
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} (code {})", self.message, self.code)
    }
}

pub fn request(id: Value, method: &str, params: Option<Value>) -> RpcRequest {
    RpcRequest {
        jsonrpc: JSONRPC_VERSION.to_string(),
        id,
        method: method.to_string(),
        params,
    }
}

pub fn notification(method: &str, params: Option<Value>) -> RpcNotification {
    RpcNotification {
        jsonrpc: JSONRPC_VERSION.to_string(),
        method: method.to_string(),
        params,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serializes_without_params_when_none() {
        let req = request(Value::from(1), METHOD_PING, None);
        let s = serde_json::to_string(&req).unwrap();
        assert!(!s.contains("params"));
        assert!(s.contains("\"method\":\"ping\""));
    }

    #[test]
    fn response_roundtrip_with_error() {
        let raw = r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"nope"}}"#;
        let resp: RpcResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(resp.id, 3);
        let err = resp.error.unwrap();
        assert_eq!(err.code, ERR_METHOD_NOT_FOUND);
        assert_eq!(err.message, "nope");
    }
}

//! DAP (Debug Adapter Protocol) message types.
//! Wire protocol per https://microsoft.github.io/debug-adapter-protocol/.
//! Transport framing is the LSP-style Content-Length base protocol, shared
//! with the LSP module via `crate::modules::framing`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapRequest {
    pub seq: i32,
    #[serde(rename = "type")]
    pub type_: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapResponse {
    pub seq: i32,
    #[serde(rename = "type")]
    pub type_: String,
    pub request_seq: i32,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DapEvent {
    pub seq: i32,
    #[serde(rename = "type")]
    pub type_: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

// Request commands.
pub const CMD_INITIALIZE: &str = "initialize";
pub const CMD_LAUNCH: &str = "launch";
pub const CMD_ATTACH: &str = "attach";
pub const CMD_SET_BREAKPOINTS: &str = "setBreakpoints";
pub const CMD_SET_EXCEPTION_BREAKPOINTS: &str = "setExceptionBreakpoints";
pub const CMD_CONFIGURATION_DONE: &str = "configurationDone";
pub const CMD_CONTINUE: &str = "continue";
pub const CMD_NEXT: &str = "next";
pub const CMD_STEP_IN: &str = "stepIn";
pub const CMD_STEP_OUT: &str = "stepOut";
pub const CMD_PAUSE: &str = "pause";
pub const CMD_THREADS: &str = "threads";
pub const CMD_STACKTRACE: &str = "stackTrace";
pub const CMD_SCOPES: &str = "scopes";
pub const CMD_VARIABLES: &str = "variables";
pub const CMD_DISCONNECT: &str = "disconnect";
pub const CMD_TERMINATE: &str = "terminate";
pub const CMD_EVALUATE: &str = "evaluate";
pub const CMD_SOURCE: &str = "source";

// Events from the adapter.
pub const EVT_INITIALIZED: &str = "initialized";
pub const EVT_STOPPED: &str = "stopped";
pub const EVT_CONTINUED: &str = "continued";
pub const EVT_EXITED: &str = "exited";
pub const EVT_TERMINATED: &str = "terminated";
pub const EVT_OUTPUT: &str = "output";
pub const EVT_BREAKPOINT: &str = "breakpoint";
pub const EVT_THREAD: &str = "thread";
pub const EVT_PROCESS: &str = "process";
pub const EVT_MODULE: &str = "module";
pub const EVT_CAPABILITIES: &str = "capabilities";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip() {
        let raw = r#"{"seq":1,"type":"request","command":"launch","arguments":{"noDebug":true}}"#;
        let req: DapRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.command, CMD_LAUNCH);
        assert_eq!(req.seq, 1);
    }

    #[test]
    fn response_roundtrip() {
        let raw = r#"{"seq":2,"type":"response","request_seq":1,"success":true,"command":"initialize","body":{"supportsFunctionBreakpoints":true}}"#;
        let resp: DapResponse = serde_json::from_str(raw).unwrap();
        assert!(resp.success);
        assert_eq!(resp.request_seq, 1);
        assert!(resp.body.unwrap().get("supportsFunctionBreakpoints").is_some());
    }
}

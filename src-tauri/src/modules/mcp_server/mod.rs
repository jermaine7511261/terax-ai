//! MCP server — exposes YaMet's read-only capabilities to external agents
//! via the Model Context Protocol (stdio, newline-delimited JSON-RPC 2.0).
//!
//! Usage: `YaMet __mcp_server [--workdir <path>]`
//!
//! This module mirrors the  gateway architecture: a main loop reads
//! stdin line-by-line, dispatches to tool handlers, and writes responses to
//! stdout. All tools are read-only and paths are sandboxed to the workspace.

pub mod protocol;
pub mod tools;

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use protocol::{parse_request, serialize_response, serialize_notification, JsonRpcResponse, ServerRequest};

/// Maximum output size per response (32 MiB).
const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

/// Run the MCP server in blocking mode (stdio).
///
/// Reads JSON-RPC requests from stdin, dispatches to tool handlers,
/// and writes responses to stdout.
pub fn run_server(workdir: &Path) {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();

    // Send the server capabilities notification immediately after startup.
    let init_notif = serialize_notification(&protocol::JsonRpcNotification::new(
        "notifications/server_ready",
        None,
    ));
    let _ = writer.write_all(init_notif.as_bytes());
    let _ = writer.write_all(b"\n");
    let _ = writer.flush();

    let mut buf = String::new();
    loop {
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(_) => break,
        }

        let request = match parse_request(&buf) {
            Ok(Some(r)) => r,
            Ok(None) => continue, // empty line
            Err(e) => {
                let resp = JsonRpcResponse::error(
                    serde_json::Value::Null,
                    -32700,
                    format!("Parse error: {e}"),
                );
                let _ = writer.write_all(serialize_response(&resp).as_bytes());
                let _ = writer.write_all(b"\n");
                let _ = writer.flush();
                continue;
            }
        };

        let response = handle_request(request, workdir);

        let Some(response) = response else {
            // JSON-RPC notification (no id): must NOT receive a response.
            continue;
        };

        let line = serialize_response(&response);
        // Enforce output limit.
        let bytes = line.as_bytes();
        let truncated = if bytes.len() > MAX_OUTPUT_BYTES {
            &bytes[..MAX_OUTPUT_BYTES]
        } else {
            bytes
        };
        let _ = writer.write_all(truncated);
        let _ = writer.write_all(b"\n");
        let _ = writer.flush();
    }
}

fn handle_request(req: ServerRequest, workdir: &Path) -> Option<JsonRpcResponse> {
    match req {
        ServerRequest::Initialize { id, params } => {
            // Echo the client's own protocol version when it's one we support,
            // else fall back to our latest. (Protocol versions are
            // dot-separated like "2025-06-18"; we accept the client's and
            // advertise it back so strict clients can correlate.)
            let client_v = params.protocol_version;
            let protocol = if client_v.is_empty() {
                "2025-06-18".to_string()
            } else {
                client_v
            };
            let resp = serde_json::json!({
                "protocolVersion": protocol,
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "yamet-mcp-server",
                    "version": env!("CARGO_PKG_VERSION")
                }
            });
            Some(JsonRpcResponse::success(id, resp))
        }
        ServerRequest::Initialized => {
            // JSON-RPC notification (no id) — must not receive a response.
            None
        }
        ServerRequest::ToolsList { id } => {
            let tool_list = tools::list_tools();
            let resp = serde_json::json!({ "tools": tool_list });
            Some(JsonRpcResponse::success(id, resp))
        }
        ServerRequest::ToolsCall { id, params } => {
            match tools::call_tool(&params.name, &params.arguments, workdir) {
                Ok(content) => {
                    Some(JsonRpcResponse::success(id, serde_json::json!({ "content": content })))
                }
                Err(e) => {
                    Some(JsonRpcResponse::error(id, -32000, e))
                }
            }
        }
        ServerRequest::Ping { id } => {
            Some(JsonRpcResponse::success(id, serde_json::json!({})))
        }
    }
}

/// CLI entry point: `YaMet __mcp_server [--workdir <path>]`.
pub fn cli_entry() {
    let args: Vec<String> = std::env::args().collect();
    let workdir = args
        .windows(2)
        .find(|w| w[0] == "--workdir")
        .map(|w| PathBuf::from(&w[1]))
        .or_else(|| std::env::var("YAMET_MCP_CWD").ok().map(PathBuf::from))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    eprintln!(
        "[yamet-mcp-server] starting, workdir={}",
        workdir.display()
    );
    run_server(&workdir);
}

#[cfg(test)]
mod tests {
    use super::*;
    

    #[test]
    fn handle_initialize_echoes_id_and_protocol() {
        let req = ServerRequest::Initialize {
            id: serde_json::json!(7),
            params: protocol::InitializeParams {
                protocol_version: "2025-06-18".into(),
                ..Default::default()
            },
        };
        let resp = handle_request(req, Path::new(".")).unwrap();
        assert_eq!(resp.id, 7); // echoes the client's request id, not hardcoded 1
        let result = resp.result.unwrap();
        assert_eq!(result["serverInfo"]["name"], "yamet-mcp-server");
        assert_eq!(result["protocolVersion"], "2025-06-18");
    }

    #[test]
    fn handle_initialize_falls_back_when_no_protocol_sent() {
        let req = ServerRequest::Initialize {
            id: serde_json::json!(1),
            params: Default::default(),
        };
        let resp = handle_request(req, Path::new(".")).unwrap();
        let result = resp.result.unwrap();
        assert_eq!(result["serverInfo"]["name"], "yamet-mcp-server");
    }

    #[test]
    fn handle_initialized_notification_is_none() {
        let resp = handle_request(ServerRequest::Initialized, Path::new("."));
        assert!(resp.is_none()); // notifications must not receive a response
    }

    #[test]
    fn handle_tools_list() {
        let req = ServerRequest::ToolsList {
            id: serde_json::json!(1),
        };
        let resp = handle_request(req, Path::new(".")).unwrap();
        let result = resp.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 6);
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"grep"));
        assert!(names.contains(&"git_status"));
    }

    #[test]
    fn handle_ping() {
        let req = ServerRequest::Ping {
            id: serde_json::json!(42),
        };
        let resp = handle_request(req, Path::new(".")).unwrap();
        assert!(resp.result.is_some());
    }

    #[test]
    fn handle_tools_call_read_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("test.txt"), "hello mcp").unwrap();
        let req = ServerRequest::ToolsCall {
            id: serde_json::json!(1),
            params: protocol::ToolsCallParams {
                name: "read_file".into(),
                arguments: serde_json::json!({"path": "test.txt"}),
            },
        };
        let resp = handle_request(req, dir.path()).unwrap();
        let content = &resp.result.unwrap()["content"];
        assert_eq!(content[0]["text"], "hello mcp");
    }

    #[test]
    fn handle_tools_call_escape_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let req = ServerRequest::ToolsCall {
            id: serde_json::json!(1),
            params: protocol::ToolsCallParams {
                name: "read_file".into(),
                arguments: serde_json::json!({"path": "../etc/passwd"}),
            },
        };
        let resp = handle_request(req, dir.path()).unwrap();
        assert!(resp.error.is_some());
    }
}

//! Process-level smoke test for the standalone CLI entry points in `main.rs`.
//!
//! These are the cheapest real E2E we can run headlessly: they spawn the
//! actual binary and exercise the `__mcp_server` branch end-to-end over stdio.
//! A full UI smoke (launch webview, click through panels) needs tauri-driver +
//! a WebDriver browser — see docs/e2e-smoke.md.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// Read lines until the response with matching `id` arrives, skipping
/// notifications (which have no id) and unrelated frames.
fn read_response<R: BufRead>(reader: &mut R, id: u64) -> serde_json::Value {
    let mut line = String::new();
    loop {
        line.clear();
        reader.read_line(&mut line).expect("read response line");
        let v: serde_json::Value =
            serde_json::from_str(&line).expect("response line is json");
        if v.get("id").and_then(serde_json::Value::as_u64) == Some(id) {
            return v;
        }
    }
}

/// `yamet __mcp_server` must complete the MCP handshake over stdio and exit
/// cleanly on stdin EOF.
#[test]
fn mcp_server_stdio_handshake() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_yamet"))
        .arg("__mcp_server")
        .current_dir(tmp.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn yamet __mcp_server");

    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);

    // initialize → result (protocol metadata), id echoed. The server may emit
    // `notifications/server_ready` before answering, so skip non-matching
    // frames instead of assuming the first line is the response.
    stdin
        .write_all(
            b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n",
        )
        .expect("write initialize");
    let resp = read_response(&mut reader, 1);
    assert_eq!(resp["jsonrpc"], "2.0");
    assert!(
        resp.get("result").is_some(),
        "initialize must return a result, got: {resp}"
    );

    // ping → result, id echoed.
    stdin
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}\n")
        .expect("write ping");
    let resp = read_response(&mut reader, 2);
    assert_eq!(resp["id"], 2);
    assert!(
        resp.get("result").is_some(),
        "ping must return a result, got: {resp}"
    );

    // EOF on stdin → server exits with code 0.
    drop(stdin);
    let status = child.wait().expect("wait for mcp server exit");
    assert!(status.success(), "mcp server should exit 0 on stdin EOF");
}

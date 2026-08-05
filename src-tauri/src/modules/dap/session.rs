//! DAP session host: spawn a debug adapter as a subprocess and speak
//! DAP (JSON-RPC + Content-Length framing) over its stdio.
//!
//! Reuses `super::super::lsp::framing` (the exact same Content-Length codec
//! the LSP client uses — DAP and LSP share the base JSON-RPC transport).
//! Responsibilities:
//!   - spawn adapter, resolve the launch/attach command
//!   - decode incoming frames, route responses to pending requests by id,
//!     dispatch reverse requests (adapter -> client) and events
//!   - 30s request timeout, stderr tail for crash diagnostics
//!   - kill the process tree on drop

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use shared_child::SharedChild;
use tauri::ipc::{Channel, Response};

use super::super::lsp::framing::{encode_frame, FrameDecoder};

const READ_BUF: usize = 32 * 1024;
const STDERR_TAIL_LINES: usize = 8;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Exit payload delivered over the on_exit channel.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapExit {
    pub code: Option<i32>,
    pub stderr_tail: String,
}

/// An inbound DAP message classified for the frontend.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DapInbound {
    /// Response to a request we sent (matched by request id).
    Response { id: i64, body: serde_json::Value },
    /// Adapter -> client request (reverse request) needing a reply.
    ReverseRequest { id: i64, method: String, params: serde_json::Value },
    /// Notification / event (no id).
    Event { method: String, params: serde_json::Value },
}

pub struct DapSession {
    pub id: u32,
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
    child: Arc<SharedChild>,
    stdin: Mutex<Option<ChildStdin>>,
    next_req_id: AtomicI64,
    pending_ref: Arc<Mutex<HashMap<i64, std::sync::mpsc::Sender<serde_json::Value>>>>,
    /// Reverse-request handlers keyed by method. A handler returns the JSON
    /// response body (null for no-body) or None to leave the request
    /// unanswered (frontend handles it out-of-band).
    reverse_handlers: Arc<Mutex<HashMap<String, Arc<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>>>>,
    pub(super) exited: Arc<AtomicBool>,
}

impl DapSession {
    /// Register a reverse-request handler (e.g. `runInTerminal`).
    pub fn on_reverse<F>(&self, method: &str, f: F)
    where
        F: Fn(serde_json::Value) -> serde_json::Value + Send + Sync + 'static,
    {
        self.reverse_handlers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(method.to_string(), Arc::new(f));
    }

    /// Encode and write a raw JSON-RPC message to the adapter. Returns the
    /// request id it was assigned if the message is a request (has no
    /// `id` — the caller supplies the request id; DAP clients own ids).
    pub fn write(&self, message: &serde_json::Value) -> Result<(), String> {
        let payload = serde_json::to_string(message)
            .map_err(|e| format!("dap serialize failed: {e}"))?;
        let mut guard = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let stdin = guard.as_mut().ok_or("dap session stdin closed")?;
        stdin
            .write_all(&encode_frame(&payload))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("dap write failed: {e}"))
    }

    /// Send a request and wait for its response. `method`/`params` build the
    /// request; we assign the id. Enforces `REQUEST_TIMEOUT`.
    pub fn request(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_req_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = std::sync::mpsc::channel::<serde_json::Value>();
        self.pending()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        let req = serde_json::json!({ "seq": id, "type": "request", "command": method, "arguments": params });
        self.write(&req)?;
        match rx.recv_timeout(REQUEST_TIMEOUT) {
            Ok(body) => {
                self.pending()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                Ok(body)
            }
            Err(_) => {
                self.pending()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                Err(format!("dap request '{method}' timed out after {}s", REQUEST_TIMEOUT.as_secs()))
            }
        }
    }

    /// Send a request without waiting for its response (fire-and-forget).
    /// Used for launch/attach whose response is deferred until
    /// `configurationDone`. Returns the assigned request id.
    pub fn send_request(&self, method: &str, params: serde_json::Value) -> i64 {
        let id = self.next_req_id.fetch_add(1, Ordering::Relaxed);
        let req = serde_json::json!({ "seq": id, "type": "request", "command": method, "arguments": params });
        let _ = self.write(&req);
        id
    }

    fn pending(&self) -> &Mutex<HashMap<i64, std::sync::mpsc::Sender<serde_json::Value>>> {
        &self.pending_ref
    }

    /// Deliver an inbound `Response` frame to the waiting caller. Returns
    /// false when no in-process request is pending (so the reader can forward
    /// it to the frontend instead of dropping it).
    fn deliver_response(&self, id: i64, body: serde_json::Value) -> bool {
        if let Some(tx) = self.pending().lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
            let _ = tx.send(body);
            true
        } else {
            false
        }
    }

    pub fn kill(&self) {
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL);
        }
        let _ = self.child.kill();
    }
}

impl Drop for DapSession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[allow(clippy::too_many_arguments)]
pub fn spawn(
    id: u32,
    command: &str,
    args: &[String],
    cwd: &std::path::Path,
    on_inbound: Channel<Response>,
    on_exit: Channel<DapExit>,
) -> Result<Arc<DapSession>, String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let child = Arc::new(
        SharedChild::spawn(&mut cmd)
            .map_err(|e| format!("dap spawn failed for {command}: {e}"))?,
    );
    let kill_on_fail = || {
        let _ = child.kill();
    };
    let stdin = child.take_stdin().ok_or_else(|| {
        kill_on_fail();
        "dap: no stdin pipe".to_string()
    })?;
    let mut stdout = child.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "dap: no stdout pipe".to_string()
    })?;
    let mut stderr = child.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "dap: no stderr pipe".to_string()
    })?;

    #[cfg(windows)]
    let job = match crate::modules::proc::job::ProcessJob::create_for(child.id()) {
        Ok(j) => Some(j),
        Err(e) => {
            log::warn!("dap job-object setup failed for pid={}: {e}", child.id());
            None
        }
    };

    let exited = Arc::new(AtomicBool::new(false));
    let pending_ref: Arc<Mutex<HashMap<i64, std::sync::mpsc::Sender<serde_json::Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let reverse_handlers = Arc::new(Mutex::new(HashMap::new()));

    let session = Arc::new(DapSession {
        id,
        #[cfg(windows)]
        _job: job,
        child: child.clone(),
        stdin: Mutex::new(Some(stdin)),
        next_req_id: AtomicI64::new(1),
        reverse_handlers,
        exited: exited.clone(),
        pending_ref,
    });

    // Reader thread: decode frames, classify inbound messages.
    let reader_session = session.clone();
    thread::Builder::new()
        .name(format!("yamet-dap-reader-{id}"))
        .spawn(move || {
            let mut decoder = FrameDecoder::default();
            let mut buf = [0u8; READ_BUF];
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => match decoder.push(&buf[..n]) {
                        Ok(frames) => {
                            for frame in frames {
                                let Ok(v) = serde_json::from_str::<serde_json::Value>(&frame) else {
                                    log::warn!("dap id={id} non-JSON frame");
                                    continue;
                                };
                                let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                match msg_type {
                                    "response" => {
                                        let rid = v.get("request_seq").and_then(|s| s.as_i64()).unwrap_or(0);
                                        // Deliver to a pending in-process request if one exists;
                                        // otherwise the frontend drove the request via dap_send and
                                        // needs the response forwarded on the inbound channel.
                                        if !reader_session.deliver_response(rid, v.clone()) {
                                            if on_inbound.send(Response::new(serde_json::json!({
                                                "kind": "response",
                                                "request_seq": rid,
                                                "body": v,
                                            }).to_string().into_bytes())).is_err() {
                                                log::info!("dap id={id}: channel closed; killing adapter");
                                                reader_session.kill();
                                                return;
                                            }
                                        }
                                    }
                                    "request" => {
                                        // Reverse request: ask the handler, send a response.
                                        let rid = v.get("seq").and_then(|s| s.as_i64()).unwrap_or(0);
                                        let method = v.get("command").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                        let params = v.get("arguments").cloned().unwrap_or(serde_json::Value::Null);
                                        let handled = reader_session.reverse_handlers
                                            .lock().unwrap_or_else(|e| e.into_inner())
                                            .get(&method).cloned();
                                        match handled {
                                            Some(h) => {
                                                let body = h(params);
                                                let resp = serde_json::json!({
                                                    "seq": reader_session.next_req_id.fetch_add(1, Ordering::Relaxed),
                                                    "type": "response",
                                                    "request_seq": rid,
                                                    "command": method,
                                                    "success": true,
                                                    "body": body,
                                                });
                                                let _ = reader_session.write(&resp);
                                            }
                                            None => {
                                                // Notify frontend; it may answer via dap_send later.
                                                let _ = on_inbound.send(Response::new(serde_json::json!({
                                                    "kind": "reverse_request",
                                                    "id": rid,
                                                    "method": method,
                                                    "params": params,
                                                }).to_string().into_bytes()));
                                            }
                                        }
                                    }
                                    _ => {
                                        // Notification / event.
                                        let method = v.get("event").and_then(|s| s.as_str()).unwrap_or("");
                                        let params = v.get("body").cloned().unwrap_or(serde_json::Value::Null);
                                        if on_inbound.send(Response::new(serde_json::json!({
                                            "kind": "event",
                                            "method": method,
                                            "params": params,
                                        }).to_string().into_bytes())).is_err() {
                                            log::info!("dap id={id}: channel closed; killing adapter");
                                            reader_session.kill();
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("dap id={id}: {e}; killing adapter");
                            reader_session.kill();
                            return;
                        }
                    },
                    Err(e) => {
                        log::debug!("dap id={id} stdout ended: {e}");
                        break;
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_tail_w = stderr_tail.clone();
    thread::Builder::new()
        .name(format!("yamet-dap-stderr-{id}"))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            let mut line: Vec<u8> = Vec::new();
            let mut push = |line: &mut Vec<u8>| {
                if line.is_empty() {
                    return;
                }
                let text = String::from_utf8_lossy(line).into_owned();
                log::debug!("dap id={id} stderr: {text}");
                {
                    let mut tail = stderr_tail_w.lock().unwrap_or_else(|e| e.into_inner());
                    if tail.len() >= STDERR_TAIL_LINES {
                        tail.remove(0);
                    }
                    tail.push(text);
                }
                line.clear();
            };
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                for &b in &buf[..n] {
                    if b == b'\n' {
                        push(&mut line);
                    } else {
                        line.push(b);
                    }
                }
            }
            push(&mut line);
        })
        .map_err(|e| e.to_string())?;

    // Waiter: reap the child, emit exit.
    let child_waiter = child;
    let exited_w = exited;
    thread::Builder::new()
        .name(format!("yamet-dap-waiter-{id}"))
        .spawn(move || {
            let code = match child_waiter.wait() {
                Ok(status) => status.code(),
                Err(e) => {
                    log::warn!("dap id={id} wait failed: {e}");
                    None
                }
            };
            exited_w.store(true, Ordering::Release);
            // Bounded, not join: a grandchild holding stdout would hang us.
            let deadline = Instant::now() + Duration::from_millis(500);
            // Reader thread join bounded via loop is skipped: reader exits on
            // stdout EOF or channel close.
            let tail = stderr_tail.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let _ = deadline;
            let exit = DapExit { code, stderr_tail: tail.join("\n") };
            if on_exit.send(exit).is_err() {
                log::debug!("dap id={id} exit send failed (channel closed)");
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(session)
}

// `pending_ref` and `_job` field (windows) are stored on the struct.
// Fields used in tests below are exercised via unit tests on `write`.
#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn write_after_kill_errors() {
        let mut cmd = Command::new("/bin/cat");
        cmd.stdin(Stdio::piped()).stdout(Stdio::null());
        let child = Arc::new(SharedChild::spawn(&mut cmd).expect("spawn"));
        let stdin = child.take_stdin();
        let (tx, _rx) = std::sync::mpsc::channel();
        let _ = tx;
        let session = DapSession {
            id: 1,
            child,
            stdin: Mutex::new(stdin),
            next_req_id: AtomicI64::new(1),
            reverse_handlers: Arc::new(Mutex::new(HashMap::new())),
            exited: Arc::new(AtomicBool::new(false)),
            pending_ref: Arc::new(Mutex::new(HashMap::new())),
        };
        session.kill();
        assert!(session.write(&serde_json::json!({"type":"request","command":"x"})).is_err());
    }
}

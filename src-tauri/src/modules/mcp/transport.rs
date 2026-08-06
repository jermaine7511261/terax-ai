//! MCP transports.
//!
//! Two wire transports, both implemented natively:
//! - `stdio`: spawns the MCP server as a child process and exchanges
//!   newline-delimited JSON-RPC messages over stdin/stdout (spec 2025-06-18).
//! - `sse`: HTTP Server-Sent Events. The client opens a GET stream on the
//!   base URL, the server replies with an `endpoint` event telling the client
//!   where to POST requests, and `message` events carry JSON-RPC responses.

use std::io::{BufRead, Read, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use shared_child::SharedChild;

use crate::modules::lsp::env::server_env_overlay;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpTransportType {
    Stdio,
    Sse,
}

#[derive(Debug, Clone)]
pub struct StdioTransportConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<Vec<(String, String)>>,
}

#[derive(Debug, Clone)]
pub struct SseTransportConfig {
    pub url: String,
    pub headers: Option<Vec<(String, String)>>,
}

const LINE_CAP: usize = 16 * 1024 * 1024;

/// One JSON-RPC message in, one out. Implementations are Send + Sync; the
/// session stores the transport in an `Arc` shared between the reader thread
/// and command threads.
pub trait McpTransport: Send + Sync {
    fn send(&self, payload: &str) -> Result<(), String>;
    /// Block until the next message arrives. Returns Err on EOF/close.
    fn recv(&self) -> Result<String, String>;
    /// Wait until the transport can carry requests (SSE needs the endpoint
    /// event first). No-op for stdio.
    fn wait_ready(&self, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.is_ready() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(25));
        }
        Err("transport never became ready".to_string())
    }
    fn is_ready(&self) -> bool {
        true
    }
    fn close(&self);
}

/// Splits raw bytes on newlines so both transports share the framing
/// convention: one JSON document per line, no embedded newlines.
struct LineReader {
    buf: Vec<u8>,
}

impl LineReader {
    fn new() -> Self {
        Self {
            buf: Vec::with_capacity(8 * 1024),
        }
    }

    /// Feed a chunk; returns complete lines (trailing `\r` stripped).
    fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        let mut consumed = 0;
        for (i, &b) in self.buf.iter().enumerate() {
            if b == b'\n' {
                let mut line: Vec<u8> = self.buf[consumed..i].to_vec();
                consumed = i + 1;
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.len() > LINE_CAP {
                    line.truncate(LINE_CAP);
                }
                out.push(line);
            }
        }
        if consumed > 0 {
            self.buf.drain(..consumed);
        }
        out
    }

    #[cfg(test)]
    fn take_partial(&mut self) -> Option<Vec<u8>> {
        if self.buf.is_empty() {
            return None;
        }
        let line = std::mem::take(&mut self.buf);
        Some(line)
    }
}

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

pub struct StdioTransport {
    child: Arc<SharedChild>,
    stdin: Mutex<Option<ChildStdin>>,
    rx: Mutex<mpsc::Receiver<String>>,
    closed: Arc<AtomicBool>,
}

impl StdioTransport {
    pub fn spawn(
        command: &str,
        args: &[String],
        env: &[(String, String)],
        cwd: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(cwd) = cwd {
            cmd.current_dir(cwd);
        }
        cmd.envs(server_env_overlay());
        for (k, v) in env {
            cmd.env(k, v);
        }
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
                .map_err(|e| format!("mcp spawn failed for {command}: {e}"))?,
        );
        let kill_on_fail = || {
            let _ = child.kill();
        };
        let stdin = child.take_stdin().ok_or_else(|| {
            kill_on_fail();
            "mcp: no stdin pipe".to_string()
        })?;
        let mut stdout = child.take_stdout().ok_or_else(|| {
            kill_on_fail();
            "mcp: no stdout pipe".to_string()
        })?;
        let mut stderr = child.take_stderr().ok_or_else(|| {
            kill_on_fail();
            "mcp: no stderr pipe".to_string()
        })?;

        let (tx, rx) = mpsc::channel::<String>();
        let closed = Arc::new(AtomicBool::new(false));
        let closed_w = closed.clone();

        thread::Builder::new()
            .name("yamet-mcp-reader".to_string())
            .spawn(move || {
                let mut reader = LineReader::new();
                let mut buf = [0u8; 32 * 1024];
                loop {
                    match stdout.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            for line in reader.push(&buf[..n]) {
                                if tx.send(String::from_utf8_lossy(&line).into_owned()).is_err() {
                                    return;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                closed_w.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;

        // Mirror stderr to the log so misbehaving servers are debuggable.
        let label = command.to_string();
        let _ = thread::Builder::new()
            .name("yamet-mcp-stderr".to_string())
            .spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    log::debug!(
                        "mcp {label} stderr: {}",
                        String::from_utf8_lossy(&buf[..n]).trim()
                    );
                }
            });

        Ok(Self {
            child,
            stdin: Mutex::new(Some(stdin)),
            rx: Mutex::new(rx),
            closed,
        })
    }
}

impl McpTransport for StdioTransport {
    fn send(&self, payload: &str) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("mcp transport closed".to_string());
        }
        let mut guard = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let stdin = guard.as_mut().ok_or("mcp stdin closed")?;
        let mut line = payload.as_bytes().to_vec();
        line.push(b'\n');
        stdin
            .write_all(&line)
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("mcp write failed: {e}"))
    }

    fn recv(&self) -> Result<String, String> {
        self.rx
            .lock()
            .unwrap()
            .recv()
            .map_err(|_| "mcp stdout closed".to_string())
    }

    fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.child.id() as libc::pid_t), libc::SIGKILL);
        }
        let _ = self.child.kill();
    }
}

// ---------------------------------------------------------------------------
// SSE transport
// ---------------------------------------------------------------------------

pub struct SseTransport {
    client: reqwest::blocking::Client,
    base_url: String,
    headers: Vec<(String, String)>,
    endpoint: Arc<Mutex<Option<String>>>,
    rx: Mutex<mpsc::Receiver<String>>,
    closed: Arc<AtomicBool>,
}

impl SseTransport {
    pub fn connect(url: &str, headers: &[(String, String)]) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(0)) // no overall timeout; reader runs forever
            .build()
            .map_err(|e| format!("mcp http client: {e}"))?;

        let (tx, rx) = mpsc::channel::<String>();
        let endpoint = Arc::new(Mutex::new(None));
        let endpoint_w = endpoint.clone();
        let headers_w = headers.to_vec();
        let url_w = url.to_string();
        let closed = Arc::new(AtomicBool::new(false));
        let closed_w = closed.clone();

        let base = base_url(url);
        let client_w = client.clone();
        thread::Builder::new()
            .name("yamet-mcp-sse".to_string())
            .spawn(move || {
                let mut req = client_w.get(&url_w);
                for (k, v) in &headers_w {
                    req = req.header(k, v);
                }
                match req.send() {
                    Ok(mut resp) => {
                        let mut event_name = String::new();
                        let mut data = String::new();
                        let mut reader = std::io::BufReader::new(&mut resp);
                        let mut line = String::new();
                        loop {
                            line.clear();
                            match reader.read_line(&mut line) {
                                Ok(0) => break,
                                Ok(_) => {
                                    if line == "\n" || line == "\r\n" {
                                        // Event boundary.
                                        if event_name == "endpoint" {
                                            let mut ep = endpoint_w.lock().unwrap_or_else(|e| e.into_inner());
                                            *ep = Some(resolve_endpoint(&base, data.trim()));
                                            drop(ep);
                                        } else if (event_name == "message" || event_name.is_empty())
                                            && !data.trim().is_empty()
                                        {
                                            if tx.send(data.trim().to_string()).is_err() {
                                                return;
                                            }
                                        } else if event_name == "error" && !data.trim().is_empty() {
                                            log::warn!("mcp sse error event: {}", data.trim());
                                        }
                                        event_name.clear();
                                        data.clear();
                                    } else if let Some(v) = line.strip_prefix("event:") {
                                        event_name = v.trim().to_string();
                                    } else if let Some(v) = line.strip_prefix("data:") {
                                        if !data.is_empty() {
                                            data.push('\n');
                                        }
                                        data.push_str(v.trim_start());
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                    Err(e) => log::error!("mcp sse connect failed: {e}"),
                }
                closed_w.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;

        Ok(Self {
            client,
            base_url: url.to_string(),
            headers: headers.to_vec(),
            endpoint,
            rx: Mutex::new(rx),
            closed,
        })
    }
}

impl McpTransport for SseTransport {
    fn send(&self, payload: &str) -> Result<(), String> {
        let endpoint = self.endpoint.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let url = endpoint.unwrap_or_else(|| self.base_url.clone());
        let mut req = self
            .client
            .post(&url)
            .header("Content-Type", "application/json");
        for (k, v) in &self.headers {
            req = req.header(k, v);
        }
        let resp = req
            .body(payload.to_string())
            .send()
            .map_err(|e| format!("mcp sse post failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("mcp sse post returned {}", resp.status()));
        }
        Ok(())
    }

    fn recv(&self) -> Result<String, String> {
        self.rx
            .lock()
            .unwrap()
            .recv()
            .map_err(|_| "mcp sse stream closed".to_string())
    }

    fn is_ready(&self) -> bool {
        self.endpoint.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
    }
}

fn base_url(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let authority = rest
                .split('/')
                .next()
                .unwrap_or(rest)
                .split('?')
                .next()
                .unwrap_or(rest);
            format!("{scheme}://{authority}")
        }
        None => url.to_string(),
    }
}

fn resolve_endpoint(base: &str, endpoint: &str) -> String {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return base.to_string();
    }
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        return endpoint.to_string();
    }
    if endpoint.starts_with('/') {
        return format!("{base}{endpoint}");
    }
    format!("{base}/{endpoint}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_reader_splits_and_strips_cr() {
        let mut r = LineReader::new();
        assert_eq!(r.push(b"{\"a\":1}\r\n{\"b"), vec![b"{\"a\":1}".to_vec()]);
        assert_eq!(
            r.push(b":2}\n{\"c\":3}\n"),
            vec![b"{\"b:2}".to_vec(), b"{\"c\":3}".to_vec()]
        );
    }

    #[test]
    fn line_reader_partial_tail() {
        let mut r = LineReader::new();
        assert!(r.push(b"partial").is_empty());
        assert_eq!(r.take_partial(), Some(b"partial".to_vec()));
    }

    #[test]
    fn base_url_strips_path() {
        assert_eq!(base_url("http://localhost:3001/sse"), "http://localhost:3001");
        assert_eq!(base_url("http://localhost:3001"), "http://localhost:3001");
    }

    #[test]
    fn endpoint_resolution() {
        assert_eq!(
            resolve_endpoint("http://h:1", "/msg?s=2"),
            "http://h:1/msg?s=2"
        );
        assert_eq!(
            resolve_endpoint("http://h:1", "http://other/x"),
            "http://other/x"
        );
        assert_eq!(resolve_endpoint("http://h:1", "msg"), "http://h:1/msg");
    }
}

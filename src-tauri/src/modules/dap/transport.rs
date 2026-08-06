//! DAP transports: spawn a debug adapter as a child process (stdio, the
//! common case) or connect to one over TCP. WebSocket is parsed but not yet
//! implemented; connecting reports an explicit error instead of failing
//! silently. All transports speak the Content-Length framing shared with LSP.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use shared_child::SharedChild;

use crate::modules::lsp::framing::{encode_frame, FrameDecoder};
use crate::modules::lsp::env::server_env_overlay;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DapTransportType {
    Stdio,
    WebSocket,
    Tcp,
}

#[derive(Debug, Clone)]
pub struct StdioTransportConfig {
    pub adapter_command: String,
    pub adapter_args: Vec<String>,
    pub env: Option<Vec<(String, String)>>,
}

#[derive(Debug, Clone)]
pub struct WebSocketTransportConfig {
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct TcpTransportConfig {
    pub host: String,
    pub port: u16,
}

pub trait DapTransport: Send + Sync {
    fn send_frame(&self, payload: &str) -> Result<(), String>;
    /// Block until the next decoded message arrives. Err on EOF/close.
    fn recv_frame(&self) -> Result<String, String>;
    fn close(&self);
}

// ---------------------------------------------------------------------------
// stdio transport (debug adapter child process)
// ---------------------------------------------------------------------------

pub struct StdioDapTransport {
    child: Arc<SharedChild>,
    stdin: Mutex<Option<ChildStdin>>,
    rx: Mutex<mpsc::Receiver<String>>,
    closed: Arc<AtomicBool>,
}

impl StdioDapTransport {
    pub fn spawn(
        adapter_command: &str,
        adapter_args: &[String],
        env: &[(String, String)],
        cwd: Option<&std::path::Path>,
    ) -> Result<Self, String> {
        let mut cmd = Command::new(adapter_command);
        cmd.args(adapter_args)
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

        let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| {
            format!("dap spawn failed for {adapter_command}: {e}")
        })?);
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

        let (tx, rx) = mpsc::channel::<String>();
        let closed = Arc::new(AtomicBool::new(false));
        let closed_w = closed.clone();

        thread::Builder::new()
            .name("yamet-dap-reader".to_string())
            .spawn(move || {
                let mut decoder = FrameDecoder::default();
                let mut buf = [0u8; 32 * 1024];
                loop {
                    match stdout.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => match decoder.push(&buf[..n]) {
                            Ok(msgs) => {
                                for msg in msgs {
                                    if tx.send(msg).is_err() {
                                        return;
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!("dap framing error: {e}");
                                return;
                            }
                        },
                        Err(_) => break,
                    }
                }
                closed_w.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;

        let label = adapter_command.to_string();
        let _ = thread::Builder::new()
            .name("yamet-dap-stderr".to_string())
            .spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    log::debug!(
                        "dap {label} stderr: {}",
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

impl DapTransport for StdioDapTransport {
    fn send_frame(&self, payload: &str) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("dap transport closed".to_string());
        }
        let mut guard = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let stdin = guard.as_mut().ok_or("dap stdin closed")?;
        stdin
            .write_all(&encode_frame(payload))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("dap write failed: {e}"))
    }

    fn recv_frame(&self) -> Result<String, String> {
        self.rx
            .lock()
            .unwrap()
            .recv()
            .map_err(|_| "dap stdout closed".to_string())
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
// TCP transport (connect to an already-running adapter)
// ---------------------------------------------------------------------------

pub struct TcpDapTransport {
    stream: Mutex<TcpStream>,
    rx: Mutex<mpsc::Receiver<String>>,
    closed: Arc<AtomicBool>,
}

impl TcpDapTransport {
    pub fn connect(host: &str, port: u16) -> Result<Self, String> {
        let stream = TcpStream::connect((host, port))
            .map_err(|e| format!("dap tcp connect {host}:{port} failed: {e}"))?;
        stream.set_nodelay(true).ok();
        let reader = stream
            .try_clone()
            .map_err(|e| format!("dap tcp clone failed: {e}"))?;
        let (tx, rx) = mpsc::channel::<String>();
        let closed = Arc::new(AtomicBool::new(false));
        let closed_w = closed.clone();

        thread::Builder::new()
            .name("yamet-dap-tcp-reader".to_string())
            .spawn(move || {
                let mut decoder = FrameDecoder::default();
                let mut buf = [0u8; 32 * 1024];
                let mut reader = reader;
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => match decoder.push(&buf[..n]) {
                            Ok(msgs) => {
                                for msg in msgs {
                                    if tx.send(msg).is_err() {
                                        return;
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!("dap framing error: {e}");
                                return;
                            }
                        },
                        Err(_) => break,
                    }
                }
                closed_w.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;

        Ok(Self {
            stream: Mutex::new(stream),
            rx: Mutex::new(rx),
            closed,
        })
    }
}

impl DapTransport for TcpDapTransport {
    fn send_frame(&self, payload: &str) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("dap transport closed".to_string());
        }
        self.stream
            .lock()
            .unwrap()
            .write_all(&encode_frame(payload))
            .map_err(|e| format!("dap tcp write failed: {e}"))
    }

    fn recv_frame(&self) -> Result<String, String> {
        self.rx
            .lock()
            .unwrap()
            .recv()
            .map_err(|_| "dap tcp closed".to_string())
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        let _ = self
            .stream
            .lock()
            .unwrap()
            .shutdown(std::net::Shutdown::Both);
    }
}

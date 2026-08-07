//! The PTY helper process: hosts portable-pty sessions outside the main
//! process so they survive a main-process restart. Runs as the same binary
//! with `--pty-helper`.
//!
//! Concurrency model:
//! - Sessions live in `state.sessions`; each keeps a bounded ring buffer of
//!   output plus the shared `state.client_tx` writer.
//! - The flusher thread of each session writes output through `SocketSink`
//!   into the shared writer while simultaneously appending to its ring.
//! - Exactly one client (the main process) is admitted at a time. When it
//!   disconnects, `client_tx` becomes None and sinks buffer into the rings;
//!   a reconnecting client gets a full ring replay before live output.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use rand::RngCore;

use super::protocol::{self, AgentSignalEvent, ErrorMsg, ExitEvent, Frame, FrameReader, OpenReq, SessionInfo, WriteReq};
use crate::modules::pty::session::{self, PtySink, Session};
use crate::modules::workspace::WorkspaceEnv;

// Ring cap per session: output accumulated while the main process is
// disconnected, replayed on attach. 512 KiB is ~128 full 80x24 screens.
const RING_CAP: usize = 512 * 1024;

// After the client detaches, exit if nobody reattaches in this window (the
// graceful path already exits via Shutdown).
const ORPHAN_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub struct HelperSession {
    pub id: u32,
    pub session: Arc<Session>,
    pub ring: Arc<Mutex<VecDeque<u8>>>,
}

pub struct HelperState {
    pub sessions: RwLock<HashMap<u32, HelperSession>>,
    pub token: String,
    pub client_tx: Arc<Mutex<Option<TcpStream>>>,
    pub connected: AtomicBool,
    // When the client last detached. Set on every disconnect; the reaper
    // thread exits the helper when this goes stale with no reattach.
    pub last_detach: Mutex<Option<Instant>>,
}

struct SocketSink {
    id: u32,
    ring: Arc<Mutex<VecDeque<u8>>>,
    out: Arc<Mutex<Option<TcpStream>>>,
}

impl PtySink for SocketSink {
    fn output(&self, bytes: &[u8]) -> bool {
        {
            let mut ring = self.ring.lock().unwrap_or_else(|e| e.into_inner());
            ring.extend(bytes.iter().copied());
            if ring.len() > RING_CAP {
                let over = ring.len() - RING_CAP;
                ring.drain(..over);
            }
        }
        let mut guard = self.out.lock().unwrap_or_else(|e| e.into_inner());
        let Some(tx) = guard.as_mut() else {
            return true; // disconnected: keep buffering, keep flushing
        };
        let Ok(frame) = protocol::encode(&Frame::Output {
            id: self.id,
            data: bytes.to_vec(),
        }) else {
            log::warn!("pty helper output encode failed (session {})", self.id);
            return true;
        };
        if tx.write_all(&frame).is_err() {
            // Client gone mid-write; drop the writer so we buffer until
            // reattach instead of failing every frame.
            *guard = None;
        }
        true
    }
    fn exit(&self, code: i32) {
        let Ok(frame) = protocol::encode(&Frame::Exit(ExitEvent { id: self.id, code })) else {
            log::warn!("pty helper exit encode failed (session {})", self.id);
            return;
        };
        if let Ok(mut guard) = self.out.lock() {
            if let Some(tx) = guard.as_mut() {
                let _ = tx.write_all(&frame);
            }
        }
    }
    fn agent_signal(&self, kind: &'static str, agent: Option<String>) {
        let Ok(frame) = protocol::encode(&Frame::AgentSignal(AgentSignalEvent {
            id: self.id,
            kind: kind.to_string(),
            agent,
        })) else {
            log::warn!("pty helper agent_signal encode failed (session {})", self.id);
            return;
        };
        if let Ok(mut guard) = self.out.lock() {
            if let Some(tx) = guard.as_mut() {
                let _ = tx.write_all(&frame);
            }
        }
    }
}

pub fn state_file_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".yamet")
        .join("pty-helper.json")
}

pub fn generate_token() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn write_state(path: &Path, port: u16, token: &str) -> Result<(), String> {
    let dir = path.parent().ok_or("state file has no parent")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::json!({ "port": port, "token": token });
    let tmp = path.with_extension("json.tmp");
    // Write the token/port state with owner-only permissions (0600) on Unix:
    // this token is the sole credential for the 127.0.0.1 helper listener, so
    // a world-readable file would let any local user inject keystrokes into
    // the active PTY or kill sessions. The atomic tmp+rename is kept.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true).mode(0o600);
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut f, &serde_json::to_vec(&json).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&tmp, serde_json::to_vec(&json).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Entry point for `--pty-helper`. Blocks forever serving the main process.
pub fn run(token: String, state_file: PathBuf) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    write_state(&state_file, port, &token)?;
    let state = Arc::new(HelperState {
        sessions: RwLock::new(HashMap::new()),
        token,
        client_tx: Arc::new(Mutex::new(None)),
        connected: AtomicBool::new(false),
        last_detach: Mutex::new(None),
    });
    log::info!("pty helper listening on 127.0.0.1:{port}");

    // Orphan reaper: a graceful main-process exit sends Shutdown and exits us
    // immediately; a crash leaves us detached. If nobody reconnects within
    // ORPHAN_TIMEOUT the held sessions are not coming back, so exit to avoid
    // leaking a headless process.
    {
        let state = state.clone();
        thread::Builder::new()
            .name("yamet-helper-reaper".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_secs(30));
                if state.connected.load(Ordering::Acquire) {
                    continue;
                }
                let gone = state.last_detach.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(t) = *gone {
                    if t.elapsed() > ORPHAN_TIMEOUT {
                        log::info!("pty helper: no client for {ORPHAN_TIMEOUT:?}, exiting");
                        std::process::exit(0);
                    }
                }
            })
            .expect("spawn helper reaper thread");
    }
    for conn in listener.incoming() {
        let Ok(stream) = conn else { continue };
        let state = state.clone();
        thread::Builder::new()
            .name("yamet-helper-conn".into())
            .spawn(move || handle_connection(stream, state))
            .expect("spawn helper connection thread");
    }
    let _ = std::fs::remove_file(&state_file);
    Ok(())
}

fn handle_connection(stream: TcpStream, state: Arc<HelperState>) {
    // Only one client (the main process) at a time; reject stragglers before
    // they consume any bandwidth.
    if state.connected.swap(true, Ordering::AcqRel) {
        log::warn!("pty helper: rejecting concurrent connection");
        return;
    }
    let Ok(writer) = stream.try_clone() else {
        state.connected.store(false, Ordering::Release);
        return;
    };
    let mut reader = FrameReader::new(stream);

    // Auth handshake: the first frame must present the spawn-time token.
    match reader.read_frame() {
        Ok(Some((t, body))) => {
            let ok = t == protocol::TYPE_AUTH
                && matches!(
                    protocol::decode(body.len(), t, &body),
                    Some(Frame::Auth { token }) if token == state.token
                );
            if !ok {
                log::warn!("pty helper: auth failed");
                state.connected.store(false, Ordering::Release);
                return;
            }
        }
        _ => {
            state.connected.store(false, Ordering::Release);
            return;
        }
    }
    log::info!("pty helper: client attached");

    // Adopt the client: attach replay first (existing sessions' rings), then
    // live output flows through the shared writer.
    {
        let mut out = state.client_tx.lock().unwrap_or_else(|e| e.into_inner());
        *out = Some(writer);
    }
    {
        let sessions = state.sessions.read().unwrap_or_else(|e| e.into_inner());
        for s in sessions.values() {
            let data: Vec<u8> = {
                let ring = s.ring.lock().unwrap_or_else(|e| e.into_inner());
                ring.iter().copied().collect()
            };
            if data.is_empty() {
                continue;
            }
            if let Ok(frame) = protocol::encode(&Frame::Output { id: s.id, data }) {
                let mut out = state.client_tx.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(tx) = out.as_mut() {
                    let _ = tx.write_all(&frame);
                }
            }
        }
    }

    loop {
        match reader.read_frame() {
            Ok(Some((t, body))) => {
                let Some(frame) = protocol::decode(body.len(), t, &body) else {
                    continue;
                };
                match frame {
                    Frame::Open(req) => handle_open(&state, req),
                    Frame::Write(req) => handle_write(&state, req),
                    Frame::Resize(req) => handle_resize(&state, req),
                    Frame::Kill(req) => handle_kill(&state, req),
                    Frame::List => handle_list(&state),
                    Frame::Replay { id } => handle_replay(&state, id),
                    Frame::Ping => {
                        send_frame(&state, &Frame::Pong);
                    }
                    Frame::Shutdown => {
                        cleanup(&state);
                        return;
                    }
                    _ => {}
                }
            }
            Ok(None) => break,
            Err(e) => {
                log::debug!("pty helper connection error: {e}");
                break;
            }
        }
    }

    // Disconnect: drop the shared writer so sinks buffer instead of failing.
    *state.client_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *state.last_detach.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    state.connected.store(false, Ordering::Release);
    log::info!("pty helper: client detached");
}

fn handle_open(state: &Arc<HelperState>, req: OpenReq) {
    if req.ssh_host.is_some() {
        send_frame(
            state,
            &Frame::Error(ErrorMsg { message: "pty helper: ssh sessions not supported yet".into() }),
        );
        return;
    }
    let id = req.id;
    let workspace = parse_workspace(req.workspace.as_deref());
    let ring = Arc::new(Mutex::new(VecDeque::new()));
    let sink = Arc::new(SocketSink {
        id,
        ring: ring.clone(),
        out: state.client_tx.clone(),
    });
    match session::spawn_with_sink(
        id,
        req.cols,
        req.rows,
        req.cwd.clone(),
        workspace,
        req.blocks,
        req.shell.clone(),
        None,
        sink,
    ) {
        Ok((s, _)) => {
            let mut sessions = state.sessions.write().unwrap_or_else(|e| e.into_inner());
            if let Some(old) = sessions.remove(&id) {
                if let Ok(mut k) = old.session.killer.lock() {
                    let _ = k.kill();
                }
            }
            sessions.insert(id, HelperSession { id, session: s, ring });
            log::info!("pty helper: opened id={id}");
        }
        Err(e) => {
            send_frame(state, &Frame::Error(ErrorMsg { message: e }));
        }
    }
}

fn handle_write(state: &Arc<HelperState>, req: WriteReq) {
    let sessions = state.sessions.read().unwrap_or_else(|e| e.into_inner());
    if let Some(hs) = sessions.get(&req.id) {
        let result = hs
            .session
            .writer
            .lock().unwrap_or_else(|e| e.into_inner())
            .write_all(&req.data);
        if let Err(e) = result {
            log::debug!("pty helper: write id={} failed: {e}", req.id);
        }
    }
}

fn handle_resize(state: &Arc<HelperState>, req: protocol::ResizeReq) {
    let sessions = state.sessions.read().unwrap_or_else(|e| e.into_inner());
    if let Some(hs) = sessions.get(&req.id) {
        let result = hs
            .session
            .master
            .lock().unwrap_or_else(|e| e.into_inner())
            .resize(portable_pty::PtySize {
                rows: req.rows,
                cols: req.cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        if let Err(e) = result {
            log::warn!("pty helper: resize id={} failed: {e}", req.id);
        }
    }
}

fn handle_kill(state: &Arc<HelperState>, req: protocol::KillReq) {
    let mut sessions = state.sessions.write().unwrap_or_else(|e| e.into_inner());
    if let Some(hs) = sessions.remove(&req.id) {
        if let Ok(mut k) = hs.session.killer.lock() {
            let _ = k.kill();
        }
        // Drop the session on a detached thread: Windows ClosePseudoConsole
        // can block until conhost drains.
        thread::Builder::new()
            .name(format!("yamet-helper-drop-{}", req.id))
            .spawn(move || drop(hs.session))
            .expect("spawn helper drop thread");
        log::info!("pty helper: killed id={}", req.id);
    }
}

fn parse_workspace(encoded: Option<&str>) -> WorkspaceEnv {
    match encoded {
        Some(w) if w.starts_with("wsl:") => WorkspaceEnv::Wsl {
            distro: w.trim_start_matches("wsl:").to_string(),
        },
        _ => WorkspaceEnv::Local,
    }
}

// Replay a single session's ring on demand. Used by pty_helper_attach when a
// reconnect happened before the handler registered (the connect-time replay
// already went out, so this re-sends the same buffer for that session).
fn handle_replay(state: &Arc<HelperState>, id: u32) {
    let sessions = state.sessions.read().unwrap_or_else(|e| e.into_inner());
    let Some(hs) = sessions.get(&id) else {
        return;
    };
    let data: Vec<u8> = {
        let ring = hs.ring.lock().unwrap_or_else(|e| e.into_inner());
        ring.iter().copied().collect()
    };
    if data.is_empty() {
        return;
    }
    send_frame(state, &Frame::Output { id, data });
}

fn handle_list(state: &Arc<HelperState>) {
    let sessions = state.sessions.read().unwrap_or_else(|e| e.into_inner());
    let list = sessions
        .iter()
        .map(|(id, hs)| SessionInfo {
            id: *id,
            shell_pid: hs.session.shell_pid,
            exited: hs.session.exited.load(Ordering::Acquire),
        })
        .collect();
    send_frame(state, &Frame::SessionList(protocol::SessionList { sessions: list }));
}

fn cleanup(state: &Arc<HelperState>) {
    let drained: Vec<Arc<Session>> = {
        let mut sessions = state.sessions.write().unwrap_or_else(|e| e.into_inner());
        sessions.drain().map(|(_, hs)| hs.session).collect()
    };
    for s in drained {
        if let Ok(mut k) = s.killer.lock() {
            let _ = k.kill();
        }
        drop(s);
    }
    log::info!("pty helper: shutdown, killed {} session(s)", state.sessions.read().map(|m| m.len()).unwrap_or(0));
}

fn send_frame(state: &Arc<HelperState>, frame: &Frame) {
    let Ok(bytes) = protocol::encode(frame) else {
        log::warn!("pty helper send_frame encode failed");
        return;
    };
    let mut out = state.client_tx.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = out.as_mut() {
        let _ = tx.write_all(&bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_file_roundtrip() {
        let dir = std::env::temp_dir().join("yamet-helper-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("state.json");
        write_state(&path, 4321, "sekrit").unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["port"], 4321);
        assert_eq!(v["token"], "sekrit");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn token_is_hex_and_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}

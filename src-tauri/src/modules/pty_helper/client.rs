//! Main-process side of the PTY helper: a persistent connection to the
//! detached helper process that proxies PTY sessions. The frontend talks to
//! `pty_helper_*` commands exactly like `pty_*`; this module forwards frames
//! to the helper and dispatches Output/Exit/AgentSignal back to the webview.
//!
//! `HelperClientState` holds at most one live connection. `ensure_client`
//! (re)connects on demand, so a helper restart mid-session is transparent to
//! callers (a write to a dead connection fails, and the caller falls back to
//! the in-process path).

use std::collections::HashMap;
use std::io::Write;
use std::net::TcpStream;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};

use super::protocol::{self, Frame, FrameReader, OpenReq, SessionInfo};
use crate::modules::pty::RollingBuffer;
use crate::modules::pty_helper::HelperInfo;

pub struct HelperSessionHandlers {
    pub on_data: Channel<Response>,
    pub on_exit: Channel<i32>,
    /// Mirrored scrollback so `pty_helper_buffer_lines` can page large output
    /// without holding the whole stream in frontend memory.
    pub buffer: Arc<RollingBuffer>,
}

pub struct HelperClient {
    pub writer: Mutex<TcpStream>,
    pub handlers: RwLock<HashMap<u32, HelperSessionHandlers>>,
    pub sessions: RwLock<Vec<SessionInfo>>,
    pub app: AppHandle,
    pub next_id: AtomicU32,
}

#[derive(Default)]
pub struct HelperClientState(pub Mutex<Option<Arc<HelperClient>>>);

/// Resolve + connect to the helper, publishing the connection into `state`.
/// Returns Err when no helper is running and one could not be spawned, or the
/// auth handshake fails.
pub async fn ensure_client(
    app: &AppHandle,
    state: &tauri::State<'_, HelperClientState>,
) -> Result<Arc<HelperClient>, String> {
    {
        let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            // Assume the cached connection is alive; a failed write surfaces
            // as a command error and the caller falls back to the in-process
            // path (or reconnects on the next call).
            return Ok(c.clone());
        }
    }
    let info: HelperInfo = super::pty_helper_start().await?;
    let client = connect(app, &info).await?;
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(client.clone());
    Ok(client)
}

async fn connect(app: &AppHandle, info: &HelperInfo) -> Result<Arc<HelperClient>, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", info.port))
        .map_err(|e| format!("pty helper connect: {e}"))?;
    let _ = stream.set_nodelay(true);
    stream
        .write_all(&protocol::encode(&Frame::Auth {
            token: info.token.clone(),
        })?)
        .map_err(|e| format!("pty helper auth: {e}"))?;

    let client = Arc::new(HelperClient {
        writer: Mutex::new(stream.try_clone().map_err(|e| e.to_string())?),
        handlers: RwLock::new(HashMap::new()),
        sessions: RwLock::new(Vec::new()),
        app: app.clone(),
        next_id: AtomicU32::new(1),
    });

    // Reader thread: dispatch Output/Exit/AgentSignal to the registered
    // handlers; track the latest SessionList for pty_helper_list.
    let reader_client = client.clone();
    std::thread::Builder::new()
        .name("yamet-helper-client-reader".into())
        .spawn(move || {
            let mut reader = FrameReader::new(stream);
            while let Ok(Some((t, body))) = reader.read_frame() {
                let Some(frame) = protocol::decode(body.len(), t, &body) else {
                    continue;
                };
                match frame {
                            Frame::Output { id, data } => {
                                let handlers =
                                    reader_client.handlers.read().unwrap_or_else(|e| e.into_inner());
                                if let Some(h) = handlers.get(&id) {
                                    h.buffer.push(&data);
                                    let _ = h.on_data.send(Response::new(data));
                                }
                            }
                            Frame::Exit(e) => {
                                let h = reader_client
                                    .handlers
                                    .write().unwrap_or_else(|e| e.into_inner())
                                    .remove(&e.id);
                                if let Some(h) = h {
                                    let _ = h.on_exit.send(e.code);
                                }
                            }
                            Frame::AgentSignal(sig) => {
                                let _ = reader_client.app.emit(
                                    "yamet:agent-signal",
                                    serde_json::json!({
                                        "id": sig.id,
                                        "kind": sig.kind,
                                        "agent": sig.agent,
                                    }),
                                );
                            }
                            Frame::SessionList(l) => {
                                *reader_client
                                    .sessions
                                    .write().unwrap_or_else(|e| e.into_inner()) = l.sessions;
                            }
                            _ => {}
                        }
            }
            // Connection lost: fail every outstanding handler so the frontend
            // falls back to the in-process path instead of hanging.
            let handlers: Vec<(u32, HelperSessionHandlers)> = reader_client
                .handlers
                .write().unwrap_or_else(|e| e.into_inner())
                .drain()
                .collect();
            for (id, h) in handlers {
                log::warn!("pty helper connection lost, failing session {id}");
                let _ = h.on_exit.send(-1);
            }
        })
        .map_err(|e| e.to_string())?;

    // After reconnect the id counter must not collide with sessions the
    // helper already holds; seed it above the highest existing id.
    let _ = send_frame(&client, &Frame::List);
    std::thread::sleep(Duration::from_millis(200));
    let max = client
        .sessions
        .read().unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|s| s.id)
        .max()
        .unwrap_or(0);
    client.next_id.store(max + 1, Ordering::Relaxed);

    Ok(client)
}

pub fn send_frame(client: &HelperClient, frame: &Frame) -> Result<(), String> {
    let bytes = protocol::encode(frame)?;
    client
        .writer
        .lock().unwrap_or_else(|e| e.into_inner())
        .write_all(&bytes)
        .map_err(|e| format!("pty helper send: {e}"))
}

/// Open a session on the helper. The id is allocated here so reconnects keep
/// stable ids; `workspace` is encoded as "local" / "wsl:<distro>".
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pty_helper_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, HelperClientState>,
    registry: tauri::State<'_, crate::modules::workspace::WorkspaceRegistry>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<crate::modules::workspace::WorkspaceEnv>,
    blocks: Option<bool>,
    shell: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let client = ensure_client(&app, &state).await?;
    let id = client.next_id.fetch_add(1, Ordering::Relaxed);
    client
        .handlers
        .write().unwrap_or_else(|e| e.into_inner())
        .insert(
            id,
            HelperSessionHandlers {
                on_data,
                on_exit,
                buffer: Arc::new(RollingBuffer::default()),
            },
        );
    let workspace = crate::modules::workspace::WorkspaceEnv::from_option(workspace);
    let workspace_enc = match &workspace {
        crate::modules::workspace::WorkspaceEnv::Wsl { distro } => Some(format!("wsl:{distro}")),
        _ => None,
    };
    // Same workspace-authorization gate as the in-process `pty_open`: a cwd
    // outside an authorized root is refused (fall back to home) rather than
    // spawning a shell in an arbitrary directory. Mirrors `pty/mod.rs`.
    let cwd = crate::modules::workspace::user_spawn_cwd_or_home(
        &registry,
        cwd.as_deref(),
        &workspace,
    );
    let req = OpenReq {
        id,
        cols,
        rows,
        cwd,
        shell,
        blocks: blocks.unwrap_or(false),
        workspace: workspace_enc,
        ssh_host: None,
        ssh_user: None,
        ssh_port: None,
        ssh_key: None,
    };
    if let Err(e) = send_frame(&client, &Frame::Open(req)) {
        client
            .handlers
            .write().unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        return Err(e);
    }
    log::info!("pty helper opened id={id} cols={cols} rows={rows}");
    Ok(id)
}

/// Register handlers for an existing helper session (restored cold tab with a
/// persisted ptyId). The Replay frame re-sends the session's ring so output
/// that flowed before this handler existed is not lost.
#[tauri::command]
pub async fn pty_helper_attach(
    app: tauri::AppHandle,
    state: tauri::State<'_, HelperClientState>,
    id: u32,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<(), String> {
    let client = ensure_client(&app, &state).await?;
    client
        .handlers
        .write().unwrap_or_else(|e| e.into_inner())
        .insert(
            id,
            HelperSessionHandlers {
                on_data,
                on_exit,
                buffer: Arc::new(RollingBuffer::default()),
            },
        );
    send_frame(&client, &Frame::Replay { id })
}

#[tauri::command]
pub fn pty_helper_write(
    state: tauri::State<'_, HelperClientState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("x-pty-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "pty_helper_write: missing x-pty-id header".to_string())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("pty_helper_write: expected raw body".to_string());
    };
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let client = guard.as_ref().ok_or("pty helper not connected")?;
    send_frame(
        client,
        &Frame::Write(protocol::WriteReq {
            id,
            data: bytes.to_vec(),
        }),
    )
}

#[tauri::command]
pub fn pty_helper_resize(
    state: tauri::State<'_, HelperClientState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let client = guard.as_ref().ok_or("pty helper not connected")?;
    send_frame(
        client,
        &Frame::Resize(protocol::ResizeReq { id, cols, rows }),
    )
}

#[tauri::command]
pub fn pty_helper_close(
    state: tauri::State<'_, HelperClientState>,
    id: u32,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let client = guard.as_ref().ok_or("pty helper not connected")?;
    client
        .handlers
        .write().unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    send_frame(client, &Frame::Kill(protocol::KillReq { id }))
}

#[tauri::command]
pub fn pty_helper_list(
    state: tauri::State<'_, HelperClientState>,
) -> Result<Vec<SessionInfo>, String> {
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let client = guard.as_ref().ok_or("pty helper not connected")?;
    send_frame(client, &Frame::List)?;
    let list = client
        .sessions
        .read().unwrap_or_else(|e| e.into_inner())
        .clone();
    Ok(list)
}

/// Page the mirrored scrollback of a helper session — the helper equivalent of
/// `pty_buffer_lines`. `count` lines ending at (exclusive) absolute `end`;
/// `end == None` means the tail.
#[tauri::command]
pub fn pty_helper_buffer_lines(
    state: tauri::State<'_, HelperClientState>,
    id: u32,
    count: Option<usize>,
    end: Option<u64>,
) -> Result<(Vec<String>, u64, u64), String> {
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let client = guard.as_ref().ok_or("pty helper not connected")?;
    let handlers = client.handlers.read().unwrap_or_else(|e| e.into_inner());
    let h = handlers.get(&id).ok_or("no session")?;
    let n = count.unwrap_or(500).clamp(1, 5000);
    Ok(h.buffer.page(n, end))
}

/// Best-effort graceful shutdown on app exit: tell the helper to clean up and
/// exit (the orphan-reaper timeout is the backstop).
pub fn shutdown_helper(app: &AppHandle) {
    let state = app.try_state::<HelperClientState>();
    let Some(state) = state else { return };
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(client) = guard.as_ref() {
        let _ = send_frame(client, &Frame::Shutdown);
        let _ = client
            .writer
            .lock().unwrap_or_else(|e| e.into_inner())
            .shutdown(std::net::Shutdown::Both);
    }
}

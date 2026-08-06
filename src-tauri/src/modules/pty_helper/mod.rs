//! PTY helper: a detached process that hosts portable-pty sessions so they
//! survive a main-process restart (I1c process-level reconnect). The helper
//! binds 127.0.0.1, publishes its port + an auth token in
//! `~/.yamet/pty-helper.json`, and serves Open/Write/Resize/Kill/List over a
//! length-prefixed frame protocol (see `protocol`).
//!
//! Main-process side lives here too: `pty_helper_start` reuses a live helper
//! or spawns one, then returns the connection info for the frontend bridge.

pub mod client;
pub mod protocol;
mod server;

use std::io::Write;
use std::net::TcpStream;
use std::time::Duration;

pub use client::{
    pty_helper_attach, pty_helper_close, pty_helper_list, pty_helper_open,
    pty_helper_resize, pty_helper_write, shutdown_helper, HelperClientState,
};
pub use server::{generate_token, run as run_helper, state_file_path, write_state};

use protocol::{Frame, FrameReader};

#[derive(Debug, Clone, serde::Serialize)]
pub struct HelperInfo {
    pub port: u16,
    pub token: String,
}

/// True when a helper on `port` accepts our token and answers Ping.
fn ping(port: u16, token: &str) -> bool {
    let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    // Encode failures are unexpected (fixed structs); treat as "not alive".
    let Ok(auth) = protocol::encode(&Frame::Auth { token: token.to_string() }) else {
        return false;
    };
    let Ok(ping) = protocol::encode(&Frame::Ping) else {
        return false;
    };
    if s.write_all(&auth).is_err() || s.write_all(&ping).is_err() {
        return false;
    }
    let mut reader = FrameReader::new(&s);
    match reader.read_frame() {
        Ok(Some((t, body))) => {
            matches!(protocol::decode(body.len(), t, &body), Some(Frame::Pong))
        }
        _ => false,
    }
}

fn spawn_helper(token: &str) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("pty helper: {e}"))?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--pty-helper");
    cmd.env("YAMET_PTY_HELPER_TOKEN", token);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group so a parent crash cannot reap us; we detach by
        // never holding the child handle.
        cmd.process_group(0);
    }
    cmd.spawn().map_err(|e| format!("pty helper spawn: {e}"))?;
    Ok(())
}

/// Reuse a live helper or spawn one. Callers must Ping through `port`/`token`
/// before use; this only guarantees the process is up and answering.
#[tauri::command]
pub async fn pty_helper_start() -> Result<HelperInfo, String> {
    let state_file = server::state_file_path();

    // Reuse: a state file with a live, authed helper wins.
    if let Ok(raw) = std::fs::read_to_string(&state_file) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let (Some(port), Some(token)) = (v["port"].as_u64(), v["token"].as_str()) {
                let info = HelperInfo { port: port as u16, token: token.to_string() };
                if ping(info.port, &info.token) {
                    log::info!("pty helper reused on port {}", info.port);
                    return Ok(info);
                }
            }
        }
    }

    let token = generate_token();
    spawn_helper(&token)?;

    // Wait (bounded) for the helper to publish its port and answer Ping.
    for _ in 0..50 {
        if let Ok(raw) = std::fs::read_to_string(&state_file) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(port) = v["port"].as_u64() {
                    if v["token"].as_str() == Some(token.as_str())
                        && ping(port as u16, &token)
                    {
                        log::info!("pty helper spawned on port {port}");
                        return Ok(HelperInfo { port: port as u16, token });
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("pty helper failed to start".into())
}

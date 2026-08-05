//! SSH port-forward tunnels (`ssh -N -L/-R`). Each tunnel is a detached
//! child of the main process tracked in `TunnelsState`; `list`/`kill` manage
//! them. Arguments are argv-only (never a shell), with the same component
//! sanitization as `target.rs`.

use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, RwLock};

use super::target::SshTarget;

#[derive(Debug, Clone, serde::Serialize)]
pub struct TunnelInfo {
    pub id: u32,
    pub kind: String, // "local" | "remote"
    pub bind: String, // e.g. "127.0.0.1:8080"
    pub remote: String, // e.g. "localhost:3000"
    pub pid: u32,
}

struct TunnelEntry {
    child: Mutex<Child>,
    info: TunnelInfo,
}

#[derive(Default)]
pub struct TunnelsState {
    tunnels: RwLock<HashMap<u32, TunnelEntry>>,
    next_id: AtomicU32,
}

fn clean_spec(value: &str, what: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("tunnel: {what} must not be empty"));
    }
    if v.starts_with('-') || v.chars().any(char::is_whitespace) || v.chars().any(|c| c.is_control())
    {
        return Err(format!("tunnel: invalid {what}: {value:?}"));
    }
    Ok(v.to_string())
}

fn build_tunnel_command(
    target: &SshTarget,
    flag: &str,
    spec: &str,
) -> Result<Command, String> {
    let mut cmd = Command::new("ssh");
    cmd.args(["-o", "StrictHostKeyChecking=ask", "-N"]);
    cmd.arg(flag).arg(spec);
    if let Some(port) = target.port {
        if !(1..=65535).contains(&port) {
            return Err(format!("tunnel: port out of range: {port}"));
        }
        cmd.args(["-p", &port.to_string()]);
    }
    if let Some(id) = &target.identity_file {
        let id = id.trim();
        if id.is_empty() || id.chars().any(char::is_whitespace) {
            return Err("tunnel: invalid identity file".into());
        }
        cmd.args(["-i", id]);
    }
    let dest = match &target.user {
        Some(u) if !u.trim().is_empty() => format!("{}@{}", u.trim(), target.host),
        _ => target.host.clone(),
    };
    cmd.arg(dest);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(cmd)
}

/// Create a tunnel. `kind` is "local" (-L) or "remote" (-R); `bind` and
/// `remote` are `host:port` specs.
#[tauri::command]
pub fn ssh_tunnel_start(
    state: tauri::State<'_, TunnelsState>,
    target: SshTarget,
    kind: String,
    bind: String,
    remote: String,
) -> Result<u32, String> {
    let flag = match kind.as_str() {
        "local" => "-L",
        "remote" => "-R",
        other => return Err(format!("tunnel: unknown kind: {other}")),
    };
    let bind = clean_spec(&bind, "bind spec")?;
    let remote = clean_spec(&remote, "remote spec")?;
    let spec = format!("{bind}:{remote}");
    let mut cmd = build_tunnel_command(&target, flag, &spec)?;
    let child = cmd.spawn().map_err(|e| format!("tunnel spawn: {e}"))?;
    let pid = child.id();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let info = TunnelInfo {
        id,
        kind: kind.clone(),
        bind: bind.clone(),
        remote: remote.clone(),
        pid,
    };
    state
        .tunnels
        .write().unwrap_or_else(|e| e.into_inner())
        .insert(id, TunnelEntry { child: Mutex::new(child), info });
    log::info!("ssh tunnel {kind} id={id} {spec} pid={pid}");
    Ok(id)
}

#[tauri::command]
pub fn ssh_tunnel_list(state: tauri::State<'_, TunnelsState>) -> Result<Vec<TunnelInfo>, String> {
    let tunnels = state.tunnels.read().unwrap_or_else(|e| e.into_inner());
    let mut out = Vec::new();
    for entry in tunnels.values() {
        // Reap tunnels that already exited.
        let mut c = entry.child.lock().unwrap_or_else(|e| e.into_inner());
        let exited = c.try_wait().map(|s| s.is_some()).unwrap_or(false);
        drop(c);
        if exited {
            continue;
        }
        out.push(entry.info.clone());
    }
    Ok(out)
}

#[tauri::command]
pub fn ssh_tunnel_kill(state: tauri::State<'_, TunnelsState>, id: u32) -> Result<(), String> {
    let mut tunnels = state.tunnels.write().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = tunnels.remove(&id) {
        let mut c = entry.child.lock().unwrap_or_else(|e| e.into_inner());
        let _ = c.kill();
        let _ = c.wait();
        log::info!("ssh tunnel killed id={id}");
    }
    Ok(())
}

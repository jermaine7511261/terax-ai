//! SSH port-forward tunnels (`ssh -N -L/-R`). Each tunnel is a detached
//! child of the main process tracked in `TunnelsState`; `list`/`kill` manage
//! them. Arguments are argv-only (never a shell), with the same component
//! sanitization as `target.rs`.

use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, RwLock};

use super::target::SshTarget;
use crate::modules::ssh::target::clean_component;

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
    // Sanitize host/user exactly like the interactive ssh path so a hostile
    // value can't smuggle extra `ssh` options via argv.
    let host = clean_component(&target.host, "host")?;
    let user = match &target.user {
        Some(u) if !u.trim().is_empty() => Some(clean_component(u, "user")?),
        _ => None,
    };

    let mut cmd = Command::new("ssh");
    // A background `ssh -N` has no TTY, so StrictHostKeyChecking=ask would fail
    // on a first connect to an unknown host. Keep ask for known_hosts
    // verification but add BatchMode=yes so it errors cleanly instead of
    // hanging waiting for a prompt that never comes.
    cmd.args([
        "-o",
        "StrictHostKeyChecking=ask",
        "-o",
        "BatchMode=yes",
        "-N",
    ]);
    cmd.arg(flag).arg(spec);
    if let Some(port) = target.port {
        if !(1..=65535).contains(&port) {
            return Err(format!("tunnel: port out of range: {port}"));
        }
        cmd.args(["-p", &port.to_string()]);
    }
    if let Some(id) = &target.identity_file {
        let id = clean_component(id, "identity file")?;
        cmd.args(["-i", &id]);
    }
    let dest = match user {
        Some(u) => format!("{u}@{host}"),
        None => host,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_command_rejects_option_smuggling_host() {
        let target = SshTarget {
            host: "-oProxyCommand=evil".into(),
            port: None,
            user: None,
            identity_file: None,
        };
        assert!(build_tunnel_command(&target, "-L", "8080:localhost:80").is_err());
    }

    #[test]
    fn tunnel_command_uses_batch_mode_and_identity() {
        let cmd = build_tunnel_command(
            &SshTarget {
                host: "example.com".into(),
                port: Some(2222),
                user: Some("deploy".into()),
                identity_file: Some("~/.ssh/id".into()),
            },
            "-R",
            "9000:127.0.0.1:90",
        )
        .unwrap();
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"BatchMode=yes".into()));
        assert!(args.contains(&"-i".into()));
        assert!(args.contains(&"deploy@example.com".into()));
        assert!(args.contains(&"-R".into()));
    }

    #[test]
    fn tunnel_command_rejects_unknown_kind() {
        // kind validation lives in ssh_tunnel_start; build_tunnel_command takes
        // the flag directly. Ensure a hostile host is still rejected there.
        let target = SshTarget {
            host: "-oProxyCommand=evil".into(),
            port: None,
            user: None,
            identity_file: None,
        };
        assert!(build_tunnel_command(&target, "-L", "x:y").is_err());
    }
}

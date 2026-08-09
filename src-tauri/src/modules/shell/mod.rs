pub mod background;
pub mod external_agent;
pub mod ringbuffer;
pub mod session;

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use shared_child::SharedChild;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
#[cfg(windows)]
use crate::modules::workspace::validate_wsl_distro_name;

use background::{BackgroundLogResponse, BackgroundProc, BackgroundProcInfo};
use session::{SessionRunOutput, ShellSession};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 300;
/// Kill a process that produces no output for this long, even when the total
/// timeout is longer (a silent hang is almost never a working command).
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
/// Cap on concurrent shell launches (run/session/background share this).
const MAX_CONCURRENT_SHELLS: usize = 8;

/// Keys an AI-provided env map may set. Preloading a library/interpreter flag
/// would let the model hijack the spawned process, so everything outside this
/// allowlist (and anything on the hard deny list) is refused.
const ENV_KEY_ALLOWLIST: &[&str] = &[
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LC_MESSAGES",
    "LC_TIME",
    "LC_NUMERIC",
    "LC_COLLATE",
    "LC_MONETARY",
    "LC_PAPER",
    "LC_NAME",
    "LC_ADDRESS",
    "LC_TELEPHONE",
    "LC_MEASUREMENT",
    "LC_IDENTIFICATION",
    "TERM",
    "COLORTERM",
    "HOME",
    "TZ",
    "CLICOLOR",
    "FORCE_COLOR",
    "NO_COLOR",
    "GIT_TERMINAL_PROMPT",
    "GIT_ASKPASS",
    "CI",
    "NODE_ENV",
    "NODE_NO_WARNINGS",
];

/// Hard-deny regardless of allowlist membership — loader/interpreter injection.
const ENV_KEY_DENYLIST: &[&str] = &[
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_DEBUG",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FORCE_FLAT_NAMESPACE",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "RUBYLIB",
    "GEM_HOME",
    "PERL5LIB",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JAVA_OPTS",
    "CLASSPATH",
    "BASH_ENV",
    "ENV",
    "PROMPT_COMMAND",
    "PATH",
    "PYTHONSTARTUP",
];

fn is_env_identifier(k: &str) -> bool {
    let mut chars = k.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Validate + filter an AI-supplied env map before it reaches a spawned
/// process. Mirrors `checkEnvKeys` on the frontend (defense in depth — both
/// layers must agree). Returns the filtered list or a refusal reason.
pub fn filter_extra_env(
    env: Option<&[(String, String)]>,
) -> Result<Vec<(String, String)>, String> {
    let Some(env) = env else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (key, value) in env {
        let upper = key.trim().to_ascii_uppercase();
        if !is_env_identifier(&upper) {
            return Err(format!("environment variable name {key:?} is not a valid identifier"));
        }
        if ENV_KEY_DENYLIST.contains(&upper.as_str()) {
            return Err(format!(
                "environment variable {key:?} is not allowed (could hijack the process)"
            ));
        }
        if !ENV_KEY_ALLOWLIST.contains(&upper.as_str()) {
            return Err(format!("environment variable {key:?} is not in the allowlist"));
        }
        out.push((key.trim().to_owned(), value.clone()));
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
}

/// Runs a one-shot command via the user's login shell. Output is capped and
/// the process is force-killed on timeout. We deliberately do NOT pipe into
/// the user's interactive PTY — that would fight their input. AI tool calls
/// are presented in chat as their own structured result.
#[tauri::command]
pub async fn shell_run_command(
    state: tauri::State<'_, ShellState>,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
    env: Option<Vec<(String, String)>>,
    registry: tauri::State<'_, WorkspaceRegistry>,
) -> Result<CommandOutput, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    let env = filter_extra_env(env.as_deref())?;

    let _permit = state.semaphore.clone().acquire_owned()
        .await
        .map_err(|e| format!("shell semaphore closed: {e}"))?;

    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let cwd_path = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let dur = Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    );

    // The blocking spawn + wait runs on a worker thread so the Tauri async
    // runtime stays unblocked.
    let (tx, rx) = mpsc::channel::<Result<CommandOutput, String>>();
    thread::spawn(move || {
        let _ = tx.send(run_blocking(trimmed, cwd_path, workspace, dur, env));
    });

    rx.recv().map_err(|e| e.to_string())?
}

#[cfg(all(test, unix))]
pub(crate) fn run_blocking_inner(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
) -> Result<CommandOutput, String> {
    run_blocking(command, cwd, workspace, dur, Vec::new())
}

/// Session-shell variant that also carries a validated per-call env overlay.
pub(crate) fn run_blocking_inner_with_env(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
    env: Vec<(String, String)>,
) -> Result<CommandOutput, String> {
    run_blocking(command, cwd, workspace, dur, env)
}

fn run_blocking(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    dur: Duration,
    env: Vec<(String, String)>,
) -> Result<CommandOutput, String> {
    let mut cmd = build_oneshot_command(&command, &workspace, cwd.as_deref(), &env)?;
    if let (WorkspaceEnv::Local, Some(dir)) = (&workspace, cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    // Make the child a process-group leader so a timeout kill can take down
    // its whole tree (no orphaned grandchildren, e.g. a dev server spawned by
    // `pnpm dev` surviving after the parent shell is killed).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| {
        log::warn!("shell_run_command spawn failed: {e}");
        e.to_string()
    })?);
    let mut stdout_pipe = child.take_stdout().ok_or_else(|| {
        let _ = child.kill();
        "no stdout pipe".to_string()
    })?;
    let mut stderr_pipe = child.take_stderr().ok_or_else(|| {
        let _ = child.kill();
        "no stderr pipe".to_string()
    })?;

    // Windows: assign the child to a kill-on-close Job right after spawn and
    // hold the handle until the child is reaped. Grandchildren the shell
    // spawns during the wait window (e.g. `pnpm dev`'s children) are inside
    // the job from the start, so a timeout can terminate the WHOLE tree with
    // TerminateJobObject instead of leaving orphans. Creating the job only in
    // the timeout branch would miss everything spawned before that moment.
    #[cfg(windows)]
    let job = crate::modules::proc::job::ProcessJob::create_for(child.id());

    // Track the last time either pipe produced a byte so the wait loop can
    // enforce an *idle* timeout in addition to the total wall-clock cap: a
    // process that hangs silently (no output) for IDLE_TIMEOUT is killed even
    // when the user asked for a long total timeout.
    let last_output = Arc::new(Mutex::new(std::time::Instant::now()));
    let stdout_last = Arc::clone(&last_output);
    let stderr_last = Arc::clone(&last_output);
    let stdout_handle = thread::spawn(move || drain(&mut stdout_pipe, &stdout_last));
    let stderr_handle = thread::spawn(move || drain(&mut stderr_pipe, &stderr_last));

    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });

    let started = std::time::Instant::now();
    let kill_tree = || {
        #[cfg(unix)]
        unsafe {
            let _ = libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
        }
        #[cfg(windows)]
        {
            // The job was created at spawn time and held; terminate it to
            // take down the whole tree. If job creation failed (e.g. the
            // child was already inside a non-nestable job), fall back to
            // killing just the direct process.
            if let Ok(job) = &job {
                let _ = job.terminate();
            }
            let _ = child.kill();
        }
        let _ = child.kill();
        let _ = child.wait();
    };

    let (exit_code, timed_out) = loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Ok(status)) => break (status.code(), false),
            Ok(Err(e)) => return Err(e.to_string()),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let idle = last_output
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .elapsed();
                if idle >= IDLE_TIMEOUT || started.elapsed() >= dur {
                    kill_tree();
                    break (None, true);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("shell wait thread disconnected".into());
            }
        }
    };

    let (stdout_bytes, stdout_truncated) = stdout_handle.join().unwrap_or((Vec::new(), false));
    let (stderr_bytes, stderr_truncated) = stderr_handle.join().unwrap_or((Vec::new(), false));

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        exit_code,
        timed_out,
        truncated: stdout_truncated || stderr_truncated,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Persistent agent shell state + background process state.
// ──────────────────────────────────────────────────────────────────────────

pub struct ShellState {
    sessions: RwLock<HashMap<u32, Arc<ShellSession>>>,
    bg: RwLock<HashMap<u32, Arc<BackgroundProc>>>,
    /// Bounds concurrent shell launches so a burst of AI tool calls
    /// cannot exhaust OS threads.
    semaphore: Arc<tokio::sync::Semaphore>,
    next_session_id: AtomicU32,
    next_bg_id: AtomicU32,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            bg: RwLock::new(HashMap::new()),
            semaphore: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_SHELLS)),
            next_session_id: AtomicU32::new(1),
            next_bg_id: AtomicU32::new(1),
        }
    }
}

#[tauri::command]
pub fn shell_session_open(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    let initial = match cwd.as_deref().filter(|s| !s.is_empty()) {
        Some(c) => c.to_string(),
        None => {
            if let WorkspaceEnv::Wsl { distro } = &workspace {
                crate::modules::workspace::wsl_home(distro.clone())?
            } else {
                crate::modules::fs::to_canon(dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")))
            }
        }
    };
    let session = Arc::new(ShellSession::new(initial, workspace));
    let id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().unwrap_or_else(|e| e.into_inner()).insert(id, session);
    Ok(id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn shell_session_run(
    state: tauri::State<'_, ShellState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    id: u32,
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
    workspace: Option<WorkspaceEnv>,
    env: Option<Vec<(String, String)>>,
) -> Result<SessionRunOutput, String> {
    let env = filter_extra_env(env.as_deref())?;
    let session = state
        .sessions
        .read().unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned()
        .ok_or_else(|| "no shell session".to_string())?;
    let effective_workspace = workspace.clone().unwrap_or_else(|| session.workspace.clone());
    authorize_spawn_cwd(&registry, cwd.as_deref(), &effective_workspace)?;
    let _permit = state.semaphore.clone().acquire_owned()
        .await
        .map_err(|e| format!("shell semaphore closed: {e}"))?;
    let dur = Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    );
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(session.run(command, cwd, workspace, dur, env));
    });
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn shell_session_close(state: tauri::State<ShellState>, id: u32) -> Result<(), String> {
    state.sessions.write().unwrap_or_else(|e| e.into_inner()).remove(&id);
    Ok(())
}

/// Cap on concurrently retained background entries. Exited entries are pruned
/// eagerly; this bounds the worst case where a process runs forever and the
/// UI never lists/kills it.
const MAX_BG_ENTRIES: usize = 64;

#[tauri::command]
pub fn shell_bg_spawn(
    state: tauri::State<ShellState>,
    registry: tauri::State<WorkspaceRegistry>,
    command: String,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
    // Background spawns share the concurrency budget; fail fast when it is
    // exhausted instead of queueing unboundedly. The permit is held for the
    // rest of this scope (until `proc` is dropped by the map).
    let _permit = state.semaphore.clone().try_acquire_owned()
        .map_err(|_| "too many concurrent shell processes".to_string())?;
    let id = state.next_bg_id.fetch_add(1, Ordering::Relaxed);
    let proc = background::spawn(command, cwd, workspace)?;
    let mut map = state.bg.write().unwrap_or_else(|e| e.into_inner());
    prune_bg_map(&mut map);
    map.insert(id, proc);
    Ok(id)
}
fn prune_bg_map(map: &mut HashMap<u32, Arc<BackgroundProc>>) {
    map.retain(|_, p| !p.exited.load(Ordering::Acquire));
    if map.len() >= MAX_BG_ENTRIES {
        if let Some(oldest) = map.keys().copied().min() {
            map.remove(&oldest);
        }
    }
}


#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<ShellState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<BackgroundLogResponse, String> {
    let proc = state
        .bg
        .read().unwrap_or_else(|e| e.into_inner())
        .get(&handle)
        .cloned()
        .ok_or_else(|| "no background handle".to_string())?;
    Ok(proc.read_logs(since_offset.unwrap_or(0)))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<ShellState>, handle: u32) -> Result<(), String> {
    if let Some(proc) = state.bg.read().unwrap_or_else(|e| e.into_inner()).get(&handle).cloned() {
        proc.kill();
        // Drop the entry now — the output is drained and the handle is dead;
        // keeping it would leak the 4MiB ring buffer.
        state.bg.write().unwrap_or_else(|e| e.into_inner()).remove(&handle);
    }
    Ok(())
}

#[tauri::command]
pub fn shell_bg_list(state: tauri::State<ShellState>) -> Result<Vec<BackgroundProcInfo>, String> {
    let mut map = state.bg.write().unwrap_or_else(|e| e.into_inner());
    prune_bg_map(&mut map);
    let mut out = Vec::with_capacity(map.len());
    for (id, p) in map.iter() {
        out.push(p.info(*id));
    }
    out.sort_by_key(|i| i.handle);
    Ok(out)
}
/// Detect which external agent CLIs (claude/codex//gemini/pi/) are
/// installed and their versions, for the external-agent orchestration feature.
#[tauri::command]
pub fn agent_probe() -> Vec<external_agent::ExternalAgentInfo> {
    external_agent::probe_external_agents()
}

pub(crate) fn build_oneshot_command(
    command: &str,
    #[cfg_attr(not(windows), allow(unused_variables))] workspace: &WorkspaceEnv,
    #[cfg_attr(not(windows), allow(unused_variables))] cwd: Option<&str>,
    env: &[(String, String)],
) -> Result<Command, String> {
    #[cfg(windows)]
    if let WorkspaceEnv::Wsl { distro } = workspace {
        validate_wsl_distro_name(distro)?;
        let mut cmd = Command::new("wsl.exe");
        cmd.arg("-d").arg(distro);
        if let Some(cwd) = cwd.filter(|s| !s.is_empty()) {
            cmd.arg("--cd").arg(cwd);
        }
        cmd.arg("--exec").arg("sh").arg("-lc").arg(command);
        return Ok(cmd);
    }
    #[cfg(unix)]
    {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
        for (key, value) in crate::modules::workspace::appimage_env_overrides() {
            match value {
                Some(v) => {
                    cmd.env(key, v);
                }
                None => {
                    cmd.env_remove(key);
                }
            }
        }
        cmd.envs(env.iter().cloned());
        Ok(cmd)
    }
    #[cfg(windows)]
    {
        let shell = crate::modules::pty::shell_init::windows_shell_path();
        let mut cmd = Command::new(&shell);
        let is_cmd = shell
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("cmd.exe"))
            .unwrap_or(false);
        if is_cmd {
            cmd.arg("/C").arg(command);
        } else {
            cmd.arg("-NoProfile").arg("-Command").arg(command);
        }
        cmd.envs(env.iter().cloned());
        Ok(cmd)
    }
}

fn drain<R: Read>(reader: &mut R, last_output: &Mutex<std::time::Instant>) -> (Vec<u8>, bool) {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                // Any byte counts as progress for the idle-timeout watchdog.
                *last_output
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = std::time::Instant::now();
                if out.len() >= MAX_OUTPUT_BYTES {
                    truncated = true;
                    continue;
                }
                let take = (MAX_OUTPUT_BYTES - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, truncated)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn run(cmd: &str, timeout_secs: u64) -> CommandOutput {
        run_blocking_inner(
            cmd.into(),
            None,
            WorkspaceEnv::Local,
            Duration::from_secs(timeout_secs),
        )
        .expect("run")
    }

    #[test]
    fn run_blocking_captures_stdout_and_zero_exit() {
        let out = run("printf 'hello\\n'", 5);
        assert_eq!(out.stdout, "hello\n");
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out);
        assert!(!out.truncated);
    }

    #[test]
    fn run_blocking_captures_stderr_and_nonzero_exit() {
        let out = run("printf 'oops\\n' >&2; exit 3", 5);
        assert!(out.stderr.contains("oops"));
        assert_eq!(out.exit_code, Some(3));
    }

    #[test]
    fn run_blocking_times_out_long_running_command() {
        let out = run("sleep 10", 1);
        assert!(out.timed_out);
        assert_eq!(out.exit_code, None);
    }

    #[test]
    fn run_blocking_truncates_huge_output() {
        let big = MAX_OUTPUT_BYTES + 4096;
        let out = run(&format!("head -c {big} /dev/zero"), 10);
        assert!(out.truncated);
        assert!(out.stdout.len() <= MAX_OUTPUT_BYTES);
    }

    #[test]
    fn build_oneshot_command_uses_sh_minus_c_on_unix() {
        let cmd = build_oneshot_command("echo hi", &WorkspaceEnv::Local, None, &[]).unwrap();
        assert_eq!(cmd.get_program(), "/bin/sh");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args, vec!["-c", "echo hi"]);
    }

    #[test]
    fn filter_extra_env_allows_only_allowlisted_keys() {
        assert_eq!(
            filter_extra_env(Some(&[("NODE_ENV".into(), "production".into())])).unwrap(),
            vec![("NODE_ENV".to_string(), "production".to_string())]
        );
        // Lowercase keys are normalized.
        assert!(filter_extra_env(Some(&[("node_env".into(), "x".into())])).is_ok());
        // Loader-injection keys are refused.
        assert!(filter_extra_env(Some(&[("LD_PRELOAD".into(), "lib.so".into())])).is_err());
        assert!(filter_extra_env(Some(&[("NODE_OPTIONS".into(), "--inspect".into())])).is_err());
        assert!(filter_extra_env(Some(&[("PATH".into(), "/tmp".into())])).is_err());
        // Unlisted keys are refused.
        assert!(filter_extra_env(Some(&[("MY_ARBITRARY_KEY".into(), "x".into())])).is_err());
        // Invalid identifiers are refused.
        assert!(filter_extra_env(Some(&[("1BAD".into(), "x".into())])).is_err());
        // None / empty -> Ok(empty).
        assert_eq!(filter_extra_env(None).unwrap(), Vec::<(String, String)>::new());
        assert_eq!(filter_extra_env(Some(&[])).unwrap(), Vec::<(String, String)>::new());
    }

    #[test]
    fn prune_bg_map_removes_exited_entries() {
        let mut map = HashMap::new();
        let running = background::spawn("sleep 30".into(), None, WorkspaceEnv::Local).expect("spawn");
        let done = background::spawn("true".into(), None, WorkspaceEnv::Local).expect("spawn");
        // wait for `true` to exit
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline && !done.exited.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        map.insert(1, done);
        map.insert(2, running);
        prune_bg_map(&mut map);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key(&2));
        running.kill();
    }

    #[test]
    fn prune_bg_map_evicts_oldest_when_over_cap() {
        let mut map = HashMap::new();
        for i in 0..(MAX_BG_ENTRIES + 2) {
            map.insert(i as u32, background::spawn("sleep 30".into(), None, WorkspaceEnv::Local).expect("spawn"));
        }
        prune_bg_map(&mut map);
        assert!(map.len() <= MAX_BG_ENTRIES, "len={}", map.len());
        assert!(!map.contains_key(&0), "oldest handle must be evicted");
        for (_, p) in map.values() { p.kill(); }
    }
}

use std::collections::HashMap;
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::time::Instant;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub enum BackendKind {
    Local,
    Docker,
    SSH,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BackendConfig {
    pub id: String,
    pub name: String,
    pub kind: BackendKind,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    pub container: Option<String>,
    pub image: Option<String>,
    pub work_dir: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub enabled: bool,
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Local".into(),
            kind: BackendKind::Local,
            host: None,
            port: None,
            user: None,
            identity_file: None,
            container: None,
            image: None,
            work_dir: None,
            env: None,
            enabled: true,
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BackendStatus {
    pub id: String,
    pub name: String,
    pub kind: BackendKind,
    pub connected: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

pub trait BackendConnector: Send + Sync {
    fn kind(&self) -> BackendKind;
    fn execute(&self, command: &str, work_dir: Option<&str>, env: Option<&HashMap<String, String>>) -> Result<Output, String>;
    fn test_connection(&self) -> Result<u64, String>;
}

pub struct LocalConnector;

impl BackendConnector for LocalConnector {
    fn kind(&self) -> BackendKind { BackendKind::Local }

    fn execute(&self, command: &str, work_dir: Option<&str>, env: Option<&HashMap<String, String>>) -> Result<Output, String> {
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/C", command]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", command]);
            c
        };
        if let Some(dir) = work_dir {
            cmd.current_dir(dir);
        }
        if let Some(env_map) = env {
            cmd.envs(env_map);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.output().map_err(|e| format!("local exec failed: {e}"))
    }

    fn test_connection(&self) -> Result<u64, String> {
        let start = Instant::now();
        let out = self.execute("echo ok", None, None)?;
        let latency = start.elapsed().as_millis() as u64;
        if out.status.success() { Ok(latency) } else { Err("local echo failed".into()) }
    }
}

pub struct DockerConnector {
    config: BackendConfig,
}

impl DockerConnector {
    pub fn new(config: BackendConfig) -> Self { Self { config } }

    fn build_args(&self, command: &str, work_dir: Option<&str>, env: Option<&HashMap<String, String>>) -> Vec<String> {
        let mut args = vec!["exec".into()];
        if let Some(ref container) = self.config.container {
            args.push("-i".into());
            if let Some(ref dir) = work_dir {
                args.push("-w".into());
                args.push(dir.to_string());
            }
            if let Some(env_map) = env {
                for (k, v) in env_map {
                    args.push("-e".into());
                    args.push(format!("{k}={v}"));
                }
            }
            args.push(container.clone());
            args.push("sh".into());
            args.push("-c".into());
            args.push(command.into());
        }
        args
    }
}

impl BackendConnector for DockerConnector {
    fn kind(&self) -> BackendKind { BackendKind::Docker }

    fn execute(&self, command: &str, work_dir: Option<&str>, env: Option<&HashMap<String, String>>) -> Result<Output, String> {
        if self.config.container.is_none() {
            return Err("Docker: no container specified".into());
        }
        let args = self.build_args(command, work_dir, env);
        let mut cmd = Command::new("docker");
        cmd.args(&args);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.output().map_err(|e| format!("docker exec failed: {e}"))
    }

    fn test_connection(&self) -> Result<u64, String> {
        let start = Instant::now();
        let mut cmd = Command::new("docker");
        cmd.args(["ps", "--format", "{{.ID}}"]);
        let out = cmd.output().map_err(|e| format!("docker test failed: {e}") )?;
        let latency = start.elapsed().as_millis() as u64;
        if !out.status.success() {
            return Err("Docker daemon not reachable".into());
        }
        // Check if configured container is running
        if let Some(ref container) = self.config.container {
            let mut inspect = Command::new("docker");
            inspect.args(["inspect", "--format", "{{.State.Status}}", container]);
            let ins = inspect.output().map_err(|e| format!("docker inspect failed: {e}"))?;
            let status = String::from_utf8_lossy(&ins.stdout).trim().to_string();
            if status != "running" {
                return Err(format!("Container '{container}' is not running (status: {status})"));
            }
        }
        Ok(latency)
    }
}

pub struct SshConnector {
    config: BackendConfig,
}

impl SshConnector {
    pub fn new(config: BackendConfig) -> Self { Self { config } }

    fn build_ssh_command(&self, remote_cmd: &str) -> Command {
        let mut cmd = Command::new("ssh");
        if let Some(ref port) = self.config.port {
            cmd.args(["-p", &port.to_string()]);
        }
        if let Some(ref identity) = self.config.identity_file {
            cmd.args(["-i", identity]);
        }
        cmd.arg("-o").arg("StrictHostKeyChecking=accept-new");
        cmd.arg("-o").arg("ConnectTimeout=10");

        let user_host = match (&self.config.user, &self.config.host) {
            (Some(u), Some(h)) => format!("{u}@{h}"),
            (None, Some(h)) => h.clone(),
            _ => return cmd,
        };
        cmd.arg(&user_host);
        cmd.arg(remote_cmd);
        cmd
    }
}

impl BackendConnector for SshConnector {
    fn kind(&self) -> BackendKind { BackendKind::SSH }

    fn execute(&self, command: &str, work_dir: Option<&str>, _env: Option<&HashMap<String, String>>) -> Result<Output, String> {
        let full_cmd = match work_dir {
            Some(dir) => format!("cd {dir} && {command}"),
            None => command.to_string(),
        };
        let mut cmd = self.build_ssh_command(&full_cmd);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.output().map_err(|e| format!("ssh exec failed: {e}"))
    }

    fn test_connection(&self) -> Result<u64, String> {
        if self.config.host.is_none() {
            return Err("SSH: no host configured".into());
        }
        let start = Instant::now();
        let mut cmd = self.build_ssh_command("echo ok");
        let out = cmd.output().map_err(|e| format!("ssh test failed: {e}"))?;
        let latency = start.elapsed().as_millis() as u64;
        if out.status.success() { Ok(latency) } else {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(format!("SSH connection failed: {stderr}"))
        }
    }
}

pub struct BackendManager {
    backends: Mutex<HashMap<String, Box<dyn BackendConnector + Send + Sync>>>,
    configs: Mutex<Vec<BackendConfig>>,
}

impl Default for BackendManager {
    fn default() -> Self {
        let mut configs = Vec::new();
        configs.push(BackendConfig::default());
        let mut connectors: HashMap<String, Box<dyn BackendConnector + Send + Sync>> = HashMap::new();
        connectors.insert("local".into(), Box::new(LocalConnector));

        Self {
            backends: Mutex::new(connectors),
            configs: Mutex::new(configs),
        }
    }
}

impl BackendManager {
    pub fn new() -> Self { Self::default() }

    pub fn list_backends(&self) -> Result<Vec<BackendConfig>, String> {
        self.configs.lock().map_err(|e| e.to_string()).map(|c| c.clone())
    }

    pub fn register_backend(&self, config: BackendConfig) -> Result<(), String> {
        let connector: Box<dyn BackendConnector + Send + Sync> = match config.kind {
            BackendKind::Local => Box::new(LocalConnector),
            BackendKind::Docker => Box::new(DockerConnector::new(config.clone())),
            BackendKind::SSH => Box::new(SshConnector::new(config.clone())),
        };
        let id = config.id.clone();
        let mut backends = self.backends.lock().map_err(|e| e.to_string())?;
        let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
        backends.insert(id.clone(), connector);
        configs.push(config);
        Ok(())
    }

    pub fn remove_backend(&self, id: &str) -> Result<(), String> {
        if id == "local" { return Err("Cannot remove local backend".into()); }
        let mut backends = self.backends.lock().map_err(|e| e.to_string())?;
        let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
        backends.remove(id);
        configs.retain(|c| c.id != id);
        Ok(())
    }

    pub fn execute_on(&self, backend_id: &str, command: &str, work_dir: Option<&str>) -> Result<String, String> {
        let backends = self.backends.lock().map_err(|e| e.to_string())?;
        let connector = backends.get(backend_id).ok_or_else(|| format!("Backend not found: {backend_id}"))?;
        let configs = self.configs.lock().map_err(|e| e.to_string())?;
        let cfg = configs.iter().find(|c| c.id == backend_id);
        let env = cfg.and_then(|c| c.env.as_ref());
        let output = connector.execute(command, work_dir, env)?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Err(format!("Command failed (exit={}): {stderr}", output.status.code().unwrap_or(-1)));
        }
        Ok(if stderr.is_empty() { stdout } else { format!("{stdout}\n{stderr}") })
    }

    pub fn check_status(&self, id: &str) -> Result<BackendStatus, String> {
        let backends = self.backends.lock().map_err(|e| e.to_string())?;
        let connector = backends.get(id).ok_or_else(|| format!("Backend not found: {id}"))?;
        let configs = self.configs.lock().map_err(|e| e.to_string())?;
        let cfg = configs.iter().find(|c| c.id == id).cloned().unwrap_or_default();
        match connector.test_connection() {
            Ok(latency) => Ok(BackendStatus {
                id: id.into(), name: cfg.name, kind: connector.kind(),
                connected: true, latency_ms: Some(latency), error: None,
            }),
            Err(e) => Ok(BackendStatus {
                id: id.into(), name: cfg.name, kind: connector.kind(),
                connected: false, latency_ms: None, error: Some(e),
            }),
        }
    }

    pub fn check_all_statuses(&self) -> Result<Vec<BackendStatus>, String> {
        let configs = self.configs.lock().map_err(|e| e.to_string())?;
        let ids: Vec<String> = configs.iter().map(|c| c.id.clone()).collect();
        drop(configs);
        let mut statuses = Vec::new();
        for id in ids {
            if let Ok(s) = self.check_status(&id) {
                statuses.push(s);
            }
        }
        Ok(statuses)
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn backend_list(manager: tauri::State<'_, BackendManager>) -> Result<Vec<BackendConfig>, String> {
    manager.list_backends()
}

#[tauri::command]
pub fn backend_register(manager: tauri::State<'_, BackendManager>, config: BackendConfig) -> Result<(), String> {
    manager.register_backend(config)
}

#[tauri::command]
pub fn backend_remove(manager: tauri::State<'_, BackendManager>, id: String) -> Result<(), String> {
    manager.remove_backend(&id)
}

#[tauri::command]
pub fn backend_execute(manager: tauri::State<'_, BackendManager>, backend_id: String, command: String, work_dir: Option<String>) -> Result<String, String> {
    manager.execute_on(&backend_id, &command, work_dir.as_deref())
}

#[tauri::command]
pub fn backend_status(manager: tauri::State<'_, BackendManager>, id: String) -> Result<BackendStatus, String> {
    manager.check_status(&id)
}

#[tauri::command]
pub fn backend_status_all(manager: tauri::State<'_, BackendManager>) -> Result<Vec<BackendStatus>, String> {
    manager.check_all_statuses()
}

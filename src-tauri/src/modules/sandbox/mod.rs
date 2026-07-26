use std::sync::Mutex;

/// Sandbox restriction level.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SandboxLevel {
    /// No sandbox restrictions.
    Off,
    /// Restrict to workspace directory only.
    Workspace,
    /// Strict sandbox (read-only workspace, no network).
    Strict,
    /// Read-only sandbox (no mutations allowed anywhere).
    ReadOnly,
}

impl SandboxLevel {
    pub fn from_str(s: &str) -> Self {
        match s {
            "off" | "Off" => SandboxLevel::Off,
            "workspace" | "Workspace" => SandboxLevel::Workspace,
            "strict" | "Strict" => SandboxLevel::Strict,
            "readonly" | "ReadOnly" => SandboxLevel::ReadOnly,
            _ => SandboxLevel::Off,
        }
    }
}

/// Sandbox configuration.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SandboxConfig {
    pub level: SandboxLevel,
    pub workspace_dir: Option<String>,
    pub allow_network: bool,
    pub allow_write: bool,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            level: SandboxLevel::Off,
            workspace_dir: None,
            allow_network: true,
            allow_write: true,
        }
    }
}

pub struct Sandbox {
    config: Mutex<SandboxConfig>,
}

impl Default for Sandbox {
    fn default() -> Self {
        Self {
            config: Mutex::new(SandboxConfig::default()),
        }
    }
}

impl Sandbox {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_config(&self) -> Result<SandboxConfig, String> {
        self.config.lock().map_err(|e| e.to_string()).map(|c| c.clone())
    }

    pub fn set_config(&self, config: SandboxConfig) -> Result<(), String> {
        let mut c = self.config.lock().map_err(|e| e.to_string())?;
        *c = config;
        Ok(())
    }

    /// Check if a path is allowed to be read.
    pub fn can_read(&self, path: &str) -> Result<bool, String> {
        let config = self.config.lock().map_err(|e| e.to_string())?;
        match config.level {
            SandboxLevel::Off => Ok(true),
            SandboxLevel::Workspace | SandboxLevel::Strict | SandboxLevel::ReadOnly => {
                if let Some(ref ws) = config.workspace_dir {
                    Ok(path.starts_with(ws))
                } else {
                    Ok(true)
                }
            }
        }
    }

    /// Check if a path is allowed to be written.
    pub fn can_write(&self, path: &str) -> Result<bool, String> {
        let config = self.config.lock().map_err(|e| e.to_string())?;
        match config.level {
            SandboxLevel::Off => Ok(true),
            SandboxLevel::ReadOnly => Ok(false),
            SandboxLevel::Workspace | SandboxLevel::Strict => {
                if let Some(ref ws) = config.workspace_dir {
                    Ok(path.starts_with(ws))
                } else {
                    Ok(false)
                }
            }
        }
    }

    /// Check if network access is allowed.
    pub fn can_network(&self) -> Result<bool, String> {
        let config = self.config.lock().map_err(|e| e.to_string())?;
        match config.level {
            SandboxLevel::Off | SandboxLevel::Workspace | SandboxLevel::ReadOnly => Ok(true),
            SandboxLevel::Strict => Ok(false),
        }
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn sandbox_get_config(sandbox: tauri::State<'_, Sandbox>) -> Result<SandboxConfig, String> {
    sandbox.get_config()
}

#[tauri::command]
pub fn sandbox_set_config(
    sandbox: tauri::State<'_, Sandbox>,
    config: SandboxConfig,
) -> Result<(), String> {
    sandbox.set_config(config)
}

#[tauri::command]
pub fn sandbox_can_read(
    sandbox: tauri::State<'_, Sandbox>,
    path: String,
) -> Result<bool, String> {
    sandbox.can_read(&path)
}

#[tauri::command]
pub fn sandbox_can_write(
    sandbox: tauri::State<'_, Sandbox>,
    path: String,
) -> Result<bool, String> {
    sandbox.can_write(&path)
}

#[tauri::command]
pub fn sandbox_can_network(sandbox: tauri::State<'_, Sandbox>) -> Result<bool, String> {
    sandbox.can_network()
}

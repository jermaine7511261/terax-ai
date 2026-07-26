use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ShellHook {
    pub id: String,
    pub name: String,
    pub hook_type: HookType,
    pub command: String,
    pub pattern: Option<String>,
    pub enabled: bool,
    pub run_count: u64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum HookType {
    /// Runs before every command.
    PreCommand,
    /// Runs after every command (receives exit code).
    PostCommand,
    /// Runs when a specific pattern is matched in the command.
    OnPattern,
    /// Runs on shell startup.
    OnShellStart,
    /// Runs on shell exit.
    OnShellExit,
}

impl HookType {
    pub fn from_str(s: &str) -> Self {
        match s {
            "pre" | "PreCommand" => HookType::PreCommand,
            "post" | "PostCommand" => HookType::PostCommand,
            "pattern" | "OnPattern" => HookType::OnPattern,
            "start" | "OnShellStart" => HookType::OnShellStart,
            "exit" | "OnShellExit" => HookType::OnShellExit,
            _ => HookType::PreCommand,
        }
    }
}

pub struct ShellHooksEngine {
    hooks: Mutex<Vec<ShellHook>>,
    history: Mutex<Vec<String>>,
}

impl Default for ShellHooksEngine {
    fn default() -> Self {
        Self {
            hooks: Mutex::new(Vec::new()),
            history: Mutex::new(Vec::new()),
        }
    }
}

impl ShellHooksEngine {
    pub fn new() -> Self { Self::default() }

    pub fn list_hooks(&self) -> Result<Vec<ShellHook>, String> {
        self.hooks.lock().map_err(|e| e.to_string()).map(|h| h.clone())
    }

    pub fn register_hook(&self, hook: ShellHook) -> Result<(), String> {
        let mut hooks = self.hooks.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = hooks.iter_mut().find(|h| h.id == hook.id) {
            *existing = hook;
        } else {
            hooks.push(hook);
        }
        Ok(())
    }

    pub fn unregister_hook(&self, id: &str) -> Result<(), String> {
        let mut hooks = self.hooks.lock().map_err(|e| e.to_string())?;
        hooks.retain(|h| h.id != id);
        Ok(())
    }

    pub fn toggle_hook(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut hooks = self.hooks.lock().map_err(|e| e.to_string())?;
        if let Some(hook) = hooks.iter_mut().find(|h| h.id == id) {
            hook.enabled = enabled;
        }
        Ok(())
    }

    /// Run applicable hooks for a command.
    /// Returns list of hook outputs.
    pub fn run_hooks(&self, command: &str, hook_type: &HookType, _exit_code: Option<i32>) -> Result<Vec<String>, String> {
        let hooks = self.hooks.lock().map_err(|e| e.to_string())?;
        let mut outputs = Vec::new();
        let mut history = self.history.lock().map_err(|e| e.to_string())?;

        for hook in hooks.iter().filter(|h| h.enabled && h.hook_type == *hook_type) {
            // Pattern matching for OnPattern
            if hook_type == &HookType::OnPattern {
                if let Some(ref pat) = hook.pattern {
                    if !command.contains(pat) { continue; }
                }
            }

            // Execute hook command (simulated)
            let output = format!("[hook:{}] ran for '{}'", hook.name, command);
            outputs.push(output);
            history.push(format!("[{}] {}: {}", chrono_now(), hook.name, command));
            if history.len() > 1000 { history.remove(0); }

            // Update run count
            let _ = hook.run_count;
        }

        // Update run counts out of band
        drop(hooks);
        if let Ok(mut hooks) = self.hooks.lock() {
            for h in hooks.iter_mut() {
                if h.hook_type == *hook_type {
                    h.run_count += 1;
                }
            }
        }

        Ok(outputs)
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn hooks_list(engine: tauri::State<'_, ShellHooksEngine>) -> Result<Vec<ShellHook>, String> {
    engine.list_hooks()
}

#[tauri::command]
pub fn hooks_register(engine: tauri::State<'_, ShellHooksEngine>, hook: ShellHook) -> Result<(), String> {
    engine.register_hook(hook)
}

#[tauri::command]
pub fn hooks_unregister(engine: tauri::State<'_, ShellHooksEngine>, id: String) -> Result<(), String> {
    engine.unregister_hook(&id)
}

#[tauri::command]
pub fn hooks_run(engine: tauri::State<'_, ShellHooksEngine>, command: String, hook_type: String, exit_code: Option<i32>) -> Result<Vec<String>, String> {
    engine.run_hooks(&command, &HookType::from_str(&hook_type), exit_code)
}

#[tauri::command]
pub fn hooks_toggle(engine: tauri::State<'_, ShellHooksEngine>, id: String, enabled: bool) -> Result<(), String> {
    engine.toggle_hook(&id, enabled)
}

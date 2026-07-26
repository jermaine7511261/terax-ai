use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: String,
    pub entry: String,               // JS/TS entry point
    pub permissions: Vec<String>,     // e.g. ["fs:read", "fs:write", "net:http", "shell:exec"]
    pub hooks: Vec<String>,           // e.g. ["onToolCall", "onSessionStart", "onFileOpen"]
    pub tools: Vec<PluginToolDef>,
    pub browser_support: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginInstance {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub installed_at: String,
    pub config: serde_json::Value,
}

pub struct PluginEngine {
    plugins: Mutex<HashMap<String, PluginInstance>>,
}

impl Default for PluginEngine {
    fn default() -> Self {
        Self { plugins: Mutex::new(HashMap::new()) }
    }
}

impl PluginEngine {
    pub fn new() -> Self { Self::default() }

    pub fn register(&self, manifest: PluginManifest) -> Result<PluginInstance, String> {
        let now = iso_now();
        let instance = PluginInstance {
            manifest,
            enabled: true,
            installed_at: now,
            config: serde_json::json!({}),
        };
        let mut plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        plugins.insert(instance.manifest.id.clone(), instance.clone());
        Ok(instance)
    }

    pub fn unregister(&self, id: &str) -> Result<(), String> {
        let mut plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        plugins.remove(id);
        Ok(())
    }

    pub fn list_plugins(&self) -> Result<Vec<PluginInstance>, String> {
        let plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<PluginInstance> = plugins.values().cloned().collect();
        list.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
        Ok(list)
    }

    pub fn get_plugin(&self, id: &str) -> Result<Option<PluginInstance>, String> {
        Ok(self.plugins.lock().map_err(|e| e.to_string())?.get(id).cloned())
    }

    pub fn toggle_plugin(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        if let Some(p) = plugins.get_mut(id) {
            p.enabled = enabled;
        }
        Ok(())
    }

    pub fn update_config(&self, id: &str, config: serde_json::Value) -> Result<(), String> {
        let mut plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        if let Some(p) = plugins.get_mut(id) {
            p.config = config;
        }
        Ok(())
    }

    /// Collect all tool definitions from enabled plugins.
    pub fn collect_tools(&self) -> Result<Vec<PluginToolDef>, String> {
        let plugins = self.plugins.lock().map_err(|e| e.to_string())?;
        let mut tools = Vec::new();
        for p in plugins.values() {
            if !p.enabled { continue; }
            tools.extend(p.manifest.tools.clone());
        }
        Ok(tools)
    }
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    format!("{}", secs)
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn plugin_register(
    engine: tauri::State<'_, PluginEngine>,
    manifest: PluginManifest,
) -> Result<PluginInstance, String> {
    engine.register(manifest)
}

#[tauri::command]
pub fn plugin_unregister(
    engine: tauri::State<'_, PluginEngine>,
    id: String,
) -> Result<(), String> {
    engine.unregister(&id)
}

#[tauri::command]
pub fn plugin_list(
    engine: tauri::State<'_, PluginEngine>,
) -> Result<Vec<PluginInstance>, String> {
    engine.list_plugins()
}

#[tauri::command]
pub fn plugin_get(
    engine: tauri::State<'_, PluginEngine>,
    id: String,
) -> Result<Option<PluginInstance>, String> {
    engine.get_plugin(&id)
}

#[tauri::command]
pub fn plugin_toggle(
    engine: tauri::State<'_, PluginEngine>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    engine.toggle_plugin(&id, enabled)
}

#[tauri::command]
pub fn plugin_collect_tools(
    engine: tauri::State<'_, PluginEngine>,
) -> Result<Vec<PluginToolDef>, String> {
    engine.collect_tools()
}

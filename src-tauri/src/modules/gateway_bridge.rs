use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct GatewayConfig {
    pub id: String,
    pub platform: String,       // "telegram", "discord", "slack", "webhook"
    pub name: String,
    pub token: Option<String>,
    pub webhook_url: Option<String>,
    pub chat_id: Option<String>,
    pub enabled: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct GatewayMessage {
    pub id: String,
    pub platform: String,
    pub from: String,
    pub text: String,
    pub timestamp: String,
    pub direction: String,      // "inbound" | "outbound"
}

pub struct GatewayBridge {
    configs: Mutex<Vec<GatewayConfig>>,
    messages: Mutex<Vec<GatewayMessage>>,
}

impl Default for GatewayBridge {
    fn default() -> Self {
        Self {
            configs: Mutex::new(Vec::new()),
            messages: Mutex::new(Vec::new()),
        }
    }
}

impl GatewayBridge {
    pub fn new() -> Self { Self::default() }

    pub fn list_configs(&self) -> Result<Vec<GatewayConfig>, String> {
        self.configs.lock().map_err(|e| e.to_string()).map(|c| c.clone())
    }

    pub fn save_config(&self, config: GatewayConfig) -> Result<(), String> {
        let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = configs.iter_mut().find(|c| c.id == config.id) {
            *existing = config;
        } else {
            configs.push(config);
        }
        Ok(())
    }

    pub fn delete_config(&self, id: &str) -> Result<(), String> {
        let mut configs = self.configs.lock().map_err(|e| e.to_string())?;
        configs.retain(|c| c.id != id);
        Ok(())
    }

    pub fn record_message(&self, msg: GatewayMessage) -> Result<(), String> {
        let mut messages = self.messages.lock().map_err(|e| e.to_string())?;
        messages.push(msg);
        if messages.len() > 500 { messages.remove(0); }
        Ok(())
    }

    pub fn get_messages(&self, platform: Option<&str>, limit: usize) -> Result<Vec<GatewayMessage>, String> {
        let messages = self.messages.lock().map_err(|e| e.to_string())?;
        let filtered: Vec<GatewayMessage> = match platform {
            Some(p) => messages.iter().rev().filter(|m| m.platform == p).take(limit).cloned().collect(),
            None => messages.iter().rev().take(limit).cloned().collect(),
        };
        Ok(filtered)
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn gateway_list( bridge: tauri::State<'_, GatewayBridge>) -> Result<Vec<GatewayConfig>, String> {
    bridge.list_configs()
}

#[tauri::command]
pub fn gateway_save(bridge: tauri::State<'_, GatewayBridge>, config: GatewayConfig) -> Result<(), String> {
    bridge.save_config(config)
}

#[tauri::command]
pub fn gateway_delete(bridge: tauri::State<'_, GatewayBridge>, id: String) -> Result<(), String> {
    bridge.delete_config(&id)
}

#[tauri::command]
pub fn gateway_messages(bridge: tauri::State<'_, GatewayBridge>, platform: Option<String>, limit: Option<usize>) -> Result<Vec<GatewayMessage>, String> {
    bridge.get_messages(platform.as_deref(), limit.unwrap_or(50))
}

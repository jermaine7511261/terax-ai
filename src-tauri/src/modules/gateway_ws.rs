use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct WsMessage {
    pub id: String,
    pub platform: String,
    pub direction: String,
    pub from: String,
    pub text: String,
    pub timestamp: String,
}

pub struct GatewayWs {
    running: AtomicBool,
    messages: Mutex<Vec<WsMessage>>,
    listeners: Mutex<HashMap<String, String>>, // platform -> URL
}

impl Default for GatewayWs {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            messages: Mutex::new(Vec::new()),
            listeners: Mutex::new(HashMap::new()),
        }
    }
}

impl GatewayWs {
    pub fn new() -> Self { Self::default() }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn start_listener(&self, platform: &str, endpoint: &str) -> Result<(), String> {
        let mut listeners = self.listeners.lock().map_err(|e| e.to_string())?;
        listeners.insert(platform.into(), endpoint.into());
        self.running.store(true, Ordering::Relaxed);
        Ok(())
    }

    pub fn stop_listener(&self, platform: &str) -> Result<(), String> {
        let mut listeners = self.listeners.lock().map_err(|e| e.to_string())?;
        listeners.remove(platform);
        if listeners.is_empty() {
            self.running.store(false, Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn stop_all(&self) -> Result<(), String> {
        let mut listeners = self.listeners.lock().map_err(|e| e.to_string())?;
        listeners.clear();
        self.running.store(false, Ordering::Relaxed);
        Ok(())
    }

    pub fn list_listeners(&self) -> Result<Vec<(String, String)>, String> {
        let listeners = self.listeners.lock().map_err(|e| e.to_string())?;
        Ok(listeners.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
    }

    pub fn record_message(&self, platform: &str, from: &str, text: &str, direction: &str) -> Result<WsMessage, String> {
        let now = iso_now();
        let msg = WsMessage {
            id: format!("ws-{now}"),
            platform: platform.into(),
            direction: direction.into(),
            from: from.into(),
            text: text.into(),
            timestamp: now,
        };
        let mut messages = self.messages.lock().map_err(|e| e.to_string())?;
        messages.push(msg.clone());
        if messages.len() > 1000 { messages.remove(0); }
        Ok(msg)
    }

    pub fn get_messages(&self, platform: Option<&str>, limit: usize) -> Result<Vec<WsMessage>, String> {
        let messages = self.messages.lock().map_err(|e| e.to_string())?;
        let filtered: Vec<WsMessage> = match platform {
            Some(p) => messages.iter().rev().filter(|m| m.platform == p).take(limit).cloned().collect(),
            None => messages.iter().rev().take(limit).cloned().collect(),
        };
        Ok(filtered)
    }

    /// Enqueue an outbound message for sending via active listeners.
    pub fn send_message(&self, platform: &str, to: &str, text: &str) -> Result<WsMessage, String> {
        let msg = self.record_message(platform, &format!("bot->{to}"), text, "outbound")?;
        Ok(msg)
    }
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn ws_start(gw: tauri::State<'_, GatewayWs>, platform: String, endpoint: String) -> Result<(), String> {
    gw.start_listener(&platform, &endpoint)
}

#[tauri::command]
pub fn ws_stop(gw: tauri::State<'_, GatewayWs>, platform: String) -> Result<(), String> {
    gw.stop_listener(&platform)
}

#[tauri::command]
pub fn ws_stop_all(gw: tauri::State<'_, GatewayWs>) -> Result<(), String> {
    gw.stop_all()
}

#[tauri::command]
pub fn ws_status(gw: tauri::State<'_, GatewayWs>) -> Result<(bool, Vec<(String, String)>), String> {
    Ok((gw.is_running(), gw.list_listeners()?))
}

#[tauri::command]
pub fn ws_send(gw: tauri::State<'_, GatewayWs>, platform: String, to: String, text: String) -> Result<WsMessage, String> {
    gw.send_message(&platform, &to, &text)
}

#[tauri::command]
pub fn ws_messages(gw: tauri::State<'_, GatewayWs>, platform: Option<String>, limit: Option<usize>) -> Result<Vec<WsMessage>, String> {
    gw.get_messages(platform.as_deref(), limit.unwrap_or(50))
}

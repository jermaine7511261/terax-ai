use std::collections::HashMap;
use std::sync::Mutex;

/// MCP server definition (user-configured).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
    pub enabled: bool,
}

/// A discovered tool from an MCP server.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct McpTool {
    pub server_id: String,
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

/// MCP connection state.
struct McpConnection {
    config: McpServerConfig,
    tools: Vec<McpTool>,
}

pub struct McpManager {
    servers: Mutex<HashMap<String, McpConnection>>,
}

impl Default for McpManager {
    fn default() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }
}

impl McpManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn list_servers(&self) -> Result<Vec<McpServerConfig>, String> {
        let servers = self.servers.lock().map_err(|e| e.to_string())?;
        Ok(servers.values().map(|c| c.config.clone()).collect())
    }

    pub fn register_server(&self, config: McpServerConfig) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;
        servers.insert(
            config.id.clone(),
            McpConnection {
                tools: Vec::new(),
                config,
            },
        );
        Ok(())
    }

    pub fn unregister_server(&self, id: &str) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;
        servers.remove(id);
        Ok(())
    }

    pub fn list_tools(&self) -> Result<Vec<McpTool>, String> {
        let servers = self.servers.lock().map_err(|e| e.to_string())?;
        let mut all_tools = Vec::new();
        for conn in servers.values() {
            all_tools.extend(conn.tools.clone());
        }
        Ok(all_tools)
    }

    pub fn update_tools(&self, server_id: &str, tools: Vec<McpTool>) -> Result<(), String> {
        let mut servers = self.servers.lock().map_err(|e| e.to_string())?;
        if let Some(conn) = servers.get_mut(server_id) {
            conn.tools = tools;
        }
        Ok(())
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn mcp_list_servers(manager: tauri::State<'_, McpManager>) -> Result<Vec<McpServerConfig>, String> {
    manager.list_servers()
}

#[tauri::command]
pub fn mcp_register_server(
    manager: tauri::State<'_, McpManager>,
    config: McpServerConfig,
) -> Result<(), String> {
    manager.register_server(config)
}

#[tauri::command]
pub fn mcp_unregister_server(
    manager: tauri::State<'_, McpManager>,
    id: String,
) -> Result<(), String> {
    manager.unregister_server(&id)
}

#[tauri::command]
pub fn mcp_list_tools(manager: tauri::State<'_, McpManager>) -> Result<Vec<McpTool>, String> {
    manager.list_tools()
}

use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum GuardAction {
    Allow,
    Block,
    Flag,
    RequireApproval,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct GuardResult {
    pub action: GuardAction,
    pub reason: String,
    pub rule_id: Option<String>,
    pub severity: u8,
}

/// A single guard rule: pattern -> action.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct GuardRule {
    pub id: String,
    pub tool_pattern: String,
    pub resource_pattern: Option<String>,
    pub action: GuardAction,
    pub reason: String,
    pub severity: u8,
    pub enabled: bool,
}

pub struct ToolGuard {
    rules: Mutex<Vec<GuardRule>>,
    stats: Mutex<HashMap<String, u64>>,
}

impl Default for ToolGuard {
    fn default() -> Self {
        let rules = vec![
            GuardRule {
                id: "guard-env-dot".into(),
                tool_pattern: "read_file|write_file|edit".into(),
                resource_pattern: Some(r"\.env\b".to_string()),
                action: GuardAction::Block,
                reason: "Dotenv files may contain secrets".into(),
                severity: 10, enabled: true,
            },
            GuardRule {
                id: "guard-ssh-dir".into(),
                tool_pattern: "read_file|write_file".into(),
                resource_pattern: Some(r"\.ssh/".to_string()),
                action: GuardAction::Block,
                reason: "SSH directory contains private keys".into(),
                severity: 10, enabled: true,
            },
            GuardRule {
                id: "guard-rm-rf".into(),
                tool_pattern: "bash_run|bash_background".into(),
                resource_pattern: Some(r"rm\s+-rf\s+/".to_string()),
                action: GuardAction::Block,
                reason: "Recursive root deletion is dangerous".into(),
                severity: 10, enabled: true,
            },
            GuardRule {
                id: "guard-curl-pipe".into(),
                tool_pattern: "bash_run".into(),
                resource_pattern: Some(r"curl\s+.*\|\s*(?:sh|bash)".to_string()),
                action: GuardAction::Block,
                reason: "Piping curl to shell is a security risk".into(),
                severity: 9, enabled: true,
            },
            GuardRule {
                id: "guard-sudo".into(),
                tool_pattern: "bash_run".into(),
                resource_pattern: Some(r"^sudo\s".to_string()),
                action: GuardAction::RequireApproval,
                reason: "Sudo requires explicit approval".into(),
                severity: 7, enabled: true,
            },
            GuardRule {
                id: "guard-network-dl".into(),
                tool_pattern: "bash_run".into(),
                resource_pattern: Some(r"(?:wget|curl|npm\s+install|pip\s+install|cargo\s+install)".to_string()),
                action: GuardAction::Flag,
                reason: "Network download detected — verify before approving".into(),
                severity: 4, enabled: true,
            },
            GuardRule {
                id: "guard-destructive".into(),
                tool_pattern: "bash_run".into(),
                resource_pattern: Some(r"(?:dd\s+|mkfs\.|fdisk|format|shutdown|reboot)".to_string()),
                action: GuardAction::Block,
                reason: "Destructive system command".into(),
                severity: 10, enabled: true,
            },
        ];
        Self {
            rules: Mutex::new(rules),
            stats: Mutex::new(HashMap::new()),
        }
    }
}

impl ToolGuard {
    pub fn new() -> Self { Self::default() }

    pub fn list_rules(&self) -> Result<Vec<GuardRule>, String> {
        self.rules.lock().map_err(|e| e.to_string()).map(|r| r.clone())
    }

    pub fn add_rule(&self, rule: GuardRule) -> Result<(), String> {
        let mut rules = self.rules.lock().map_err(|e| e.to_string())?;
        rules.push(rule);
        Ok(())
    }

    pub fn remove_rule(&self, id: &str) -> Result<(), String> {
        let mut rules = self.rules.lock().map_err(|e| e.to_string())?;
        rules.retain(|r| r.id != id);
        Ok(())
    }

    pub fn toggle_rule(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut rules = self.rules.lock().map_err(|e| e.to_string())?;
        if let Some(rule) = rules.iter_mut().find(|r| r.id == id) {
            rule.enabled = enabled;
        }
        Ok(())
    }

    /// Check a tool call against all enabled guard rules.
    pub fn check(&self, tool: &str, resource: &str) -> Result<GuardResult, String> {
        let rules = self.rules.lock().map_err(|e| e.to_string())?;

        for rule in rules.iter().filter(|r| r.enabled) {
            // Match tool name
            let tool_pattern = &rule.tool_pattern;
            let tool_matches = tool_pattern.split('|').any(|p| {
                let pattern = p.replace("*", ".*");
                regex::Regex::new(&format!("^{}$", pattern)).map(|re| re.is_match(tool)).unwrap_or(false)
            });
            if !tool_matches { continue; }

            // Match resource pattern if set
            if let Some(ref res_pat) = rule.resource_pattern {
                if let Ok(re) = regex::Regex::new(res_pat) {
                    if !re.is_match(resource) { continue; }
                } else {
                    // Invalid regex — skip
                    continue;
                }
            }

            // Rule matched
            let mut stats = self.stats.lock().map_err(|e| e.to_string())?;
            *stats.entry(rule.id.clone()).or_insert(0) += 1;

            return Ok(GuardResult {
                action: rule.action.clone(),
                reason: rule.reason.clone(),
                rule_id: Some(rule.id.clone()),
                severity: rule.severity,
            });
        }

        Ok(GuardResult {
            action: GuardAction::Allow,
            reason: "No guard rules matched".into(),
            rule_id: None,
            severity: 0,
        })
    }

    pub fn get_stats(&self) -> Result<Vec<(String, u64)>, String> {
        let stats = self.stats.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<(String, u64)> = stats.iter().map(|(k, v)| (k.clone(), *v)).collect();
        list.sort_by(|a, b| b.1.cmp(&a.1));
        Ok(list)
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn guard_check(guard: tauri::State<'_, ToolGuard>, tool: String, resource: String) -> Result<GuardResult, String> {
    guard.check(&tool, &resource)
}

#[tauri::command]
pub fn guard_list_rules(guard: tauri::State<'_, ToolGuard>) -> Result<Vec<GuardRule>, String> {
    guard.list_rules()
}

#[tauri::command]
pub fn guard_add_rule(guard: tauri::State<'_, ToolGuard>, rule: GuardRule) -> Result<(), String> {
    guard.add_rule(rule)
}

#[tauri::command]
pub fn guard_remove_rule(guard: tauri::State<'_, ToolGuard>, id: String) -> Result<(), String> {
    guard.remove_rule(&id)
}

#[tauri::command]
pub fn guard_toggle_rule(guard: tauri::State<'_, ToolGuard>, id: String, enabled: bool) -> Result<(), String> {
    guard.toggle_rule(&id, enabled)
}

#[tauri::command]
pub fn guard_stats(guard: tauri::State<'_, ToolGuard>) -> Result<Vec<(String, u64)>, String> {
    guard.get_stats()
}

//! §3.5.3 User preferences extraction and persistence.
//!
//! Extracts preferences (editor style, shell, response style,常用工具) from
//! conversation text via heuristic patterns. Persists to preferences.json.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::Manager;

const PREFS_FILE: &str = "preferences.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    pub editor_style: Option<String>,
    pub shell_preference: Option<String>,
    pub common_tools: Vec<String>,
    pub response_style: Option<String>,
    pub extracted_at: Option<String>,
}

/// Pure extraction: scan text for preference signals.
pub fn extract_preferences(text: &str) -> UserPreferences {
    let lower = text.to_lowercase();
    let mut prefs = UserPreferences::default();

    if lower.contains("use vim") || lower.contains("i use vim") || lower.contains("prefer vim") {
        prefs.editor_style = Some("vim".into());
    } else if lower.contains("use emacs") || lower.contains("prefer emacs") {
        prefs.editor_style = Some("emacs".into());
    }

    let shells = [
        ("zsh", vec!["zsh", "oh-my-zsh", "oh my zsh"]),
        ("bash", vec!["bash"]),
        ("pwsh", vec!["powershell", "pwsh"]),
        ("fish", vec!["fish"]),
    ];
    for (name, patterns) in &shells {
        if patterns.iter().any(|p| lower.contains(p)) {
            prefs.shell_preference = Some(name.to_string());
            break;
        }
    }

    if lower.contains("be concise") || lower.contains("keep it short") || lower.contains("concise") {
        prefs.response_style = Some("concise".into());
    } else if lower.contains("be detailed") || lower.contains("verbose") {
        prefs.response_style = Some("verbose".into());
    }

    let mut tools = HashSet::new();
    let tool_patterns = [
        "grep", "git", "cargo", "pnpm", "npm", "bun", "yarn",
        "docker", "kubectl", "terraform", "curl", "ssh",
    ];
    for pattern in &tool_patterns {
        if lower.contains(pattern) {
            tools.insert(pattern.to_string());
        }
    }
    prefs.common_tools = tools.into_iter().collect();
    prefs.common_tools.sort();
    prefs.extracted_at = Some(Utc::now().to_rfc3339());
    prefs
}

/// Merge new preferences into existing ones (new non-None values win).
pub fn merge_preferences(existing: &UserPreferences, new: &UserPreferences) -> UserPreferences {
    UserPreferences {
        editor_style: new.editor_style.clone().or_else(|| existing.editor_style.clone()),
        shell_preference: new.shell_preference.clone().or_else(|| existing.shell_preference.clone()),
        common_tools: {
            let mut merged: HashSet<String> = existing.common_tools.iter().cloned().collect();
            merged.extend(new.common_tools.iter().cloned());
            let mut v: Vec<String> = merged.into_iter().collect();
            v.sort();
            v
        },
        response_style: new.response_style.clone().or_else(|| existing.response_style.clone()),
        extracted_at: new.extracted_at.clone().or_else(|| existing.extracted_at.clone()),
    }
}

fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(PREFS_FILE))
}

#[tauri::command]
pub async fn preferences_extract(
    app: tauri::AppHandle,
    text: String,
) -> Result<UserPreferences, String> {
    let new_prefs = extract_preferences(&text);
    let path = prefs_path(&app)?;

    let existing = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<UserPreferences>(&b).ok())
        .unwrap_or_default();

    let merged = merge_preferences(&existing, &new_prefs);
    let json = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(merged)
}

#[tauri::command]
pub async fn preferences_get(app: tauri::AppHandle) -> Result<UserPreferences, String> {
    let path = prefs_path(&app)?;
    std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<UserPreferences>(&b).ok())
        .ok_or_else(|| "no preferences found".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_vim_preference() {
        let prefs = extract_preferences("I use vim for editing");
        assert_eq!(prefs.editor_style.as_deref(), Some("vim"));
    }

    #[test]
    fn extract_shell_zsh() {
        let prefs = extract_preferences("I have oh-my-zsh configured");
        assert_eq!(prefs.shell_preference.as_deref(), Some("zsh"));
    }

    #[test]
    fn merge_combines_tools() {
        let existing = UserPreferences {
            common_tools: vec!["git".into(), "cargo".into()],
            ..Default::default()
        };
        let new = UserPreferences {
            common_tools: vec!["docker".into(), "git".into()],
            ..Default::default()
        };
        let merged = merge_preferences(&existing, &new);
        assert!(merged.common_tools.contains(&"git".into()));
        assert!(merged.common_tools.contains(&"cargo".into()));
        assert!(merged.common_tools.contains(&"docker".into()));
    }
}

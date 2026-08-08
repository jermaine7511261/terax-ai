//! Native memory subsystem (P2). Three scopes (global / workspace / session)
//! stored as a JSON journal in the app data dir. Search = lexical scoring
//! (`score.rs`) with time decay + MMR + min_score; no embedding required
//! (decision 3: FTS-only degradation primary; remote embedding optional later).

pub mod score;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::State;

use self::score::{final_score, mmr_rerank, recall_score, time_decay};

const SESSION_HALF_LIFE_SECS: f64 = 3600.0 * 4.0; // session memory decays
const DEFAULT_SOURCE_WEIGHT: f64 = 1.0;
const MIN_SCORE: f64 = 0.05;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub content: String,
    pub scope: MemoryScope,
    pub created_at: u64,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    Global,
    Workspace,
    Session,
}

#[derive(Debug, Default)]
pub struct MemoryState {
    path: Mutex<Option<PathBuf>>,
    entries: Mutex<Vec<MemoryEntry>>,
}

impl MemoryState {
    fn store_path(&self, app: &tauri::AppHandle) -> Result<PathBuf, String> {
        if let Some(p) = self.path.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            return Ok(p);
        }
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let p = dir.join("ai-memory.json");
        *self.path.lock().unwrap_or_else(|e| e.into_inner()) = Some(p.clone());
        Ok(p)
    }

    fn load(&self, app: &tauri::AppHandle) -> Vec<MemoryEntry> {
        let path = self.store_path(app).unwrap_or_default();
        let Ok(bytes) = std::fs::read(&path) else {
            return Vec::new();
        };
        serde_json::from_slice(&bytes).unwrap_or_default()
    }

    fn persist(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let path = self.store_path(app)?;
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let bytes = serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn now_secs() -> u64 {
    Utc::now().timestamp() as u64
}

fn id(scope: MemoryScope, content: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    format!("{scope:?}:{content}").hash(&mut h);
    format!("{:x}", h.finish())
}

#[tauri::command]
pub async fn memory_remember(
    app: tauri::AppHandle,
    state: State<'_, MemoryState>,
    content: String,
    scope: String,
    source: Option<String>,
) -> Result<MemoryEntry, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("empty memory content".into());
    }
    let scope = parse_scope(&scope);
    let entry = MemoryEntry {
        id: id(scope, &content),
        content,
        scope,
        created_at: now_secs(),
        source,
    };
    {
        let mut entries = state.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.is_empty() {
            *entries = state.load(&app);
        }
        // Dedup by id (hermes sync_all dedup).
        entries.retain(|e| e.id != entry.id || e.scope != scope);
        entries.push(entry.clone());
    }
    state.persist(&app)?;
    Ok(entry)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecallHit {
    pub content: String,
    pub score: f64,
    pub scope: String,
    pub created_at: u64,
}

#[tauri::command]
pub async fn memory_recall(
    app: tauri::AppHandle,
    state: State<'_, MemoryState>,
    query: String,
    limit: Option<usize>,
    scope: Option<String>,
) -> Result<Vec<MemoryRecallHit>, String> {
    let limit = limit.unwrap_or(8).clamp(1, 50);
    let filter_scope = scope.as_deref().map(parse_scope);
    let mut entries = state.entries.lock().unwrap_or_else(|e| e.into_inner());
    if entries.is_empty() {
        *entries = state.load(&app);
    }
    let now = now_secs();
    let mut scored: Vec<(String, f64)> = entries
        .iter()
        .filter(|e| filter_scope.map(|s| e.scope == s).unwrap_or(true))
        .map(|e| {
            let age = (now.saturating_sub(e.created_at)) as f64;
            let half_life = match e.scope {
                MemoryScope::Session => SESSION_HALF_LIFE_SECS,
                _ => 0.0, // global/workspace permanent
            };
            let lex = recall_score(&e.content, &query);
            let decay = time_decay(age, half_life);
            let sc = final_score(lex, age, half_life, DEFAULT_SOURCE_WEIGHT);
            // Keep the decay factor separate for the reported score so results
            // reflect freshness too.
            let _ = decay;
            (e, sc)
        })
        .filter(|(_, s)| *s > MIN_SCORE)
        .map(|(e, s)| (e.content.clone(), s))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let reranked = mmr_rerank(&scored, limit, 0.7);
    let by_id: HashMap<String, &MemoryEntry> = entries
        .iter()
        .map(|e| (e.id.clone(), e))
        .collect();
    let _ = by_id;
    Ok(reranked
        .into_iter()
        .filter_map(|(content, score)| {
            entries
                .iter()
                .find(|e| e.content == content)
                .map(|e| MemoryRecallHit {
                    content,
                    score,
                    scope: scope_label(e.scope).to_string(),
                    created_at: e.created_at,
                })
        })
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub total: usize,
    pub by_scope: HashMap<String, usize>,
}

#[tauri::command]
pub async fn memory_stats(
    app: tauri::AppHandle,
    state: State<'_, MemoryState>,
) -> Result<MemoryStats, String> {
    let mut entries = state.entries.lock().unwrap_or_else(|e| e.into_inner());
    if entries.is_empty() {
        *entries = state.load(&app);
    }
    let mut by_scope = HashMap::new();
    for e in entries.iter() {
        *by_scope.entry(scope_label(e.scope).to_string()).or_insert(0) += 1;
    }
    Ok(MemoryStats {
        total: entries.len(),
        by_scope,
    })
}

fn parse_scope(s: &str) -> MemoryScope {
    match s {
        "workspace" => MemoryScope::Workspace,
        "session" => MemoryScope::Session,
        _ => MemoryScope::Global,
    }
}

fn scope_label(s: MemoryScope) -> &'static str {
    match s {
        MemoryScope::Global => "global",
        MemoryScope::Workspace => "workspace",
        MemoryScope::Session => "session",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_parsing() {
        assert!(matches!(parse_scope("workspace"), MemoryScope::Workspace));
        assert!(matches!(parse_scope("session"), MemoryScope::Session));
        assert!(matches!(parse_scope("whatever"), MemoryScope::Global));
    }

    #[test]
    fn ids_dedup_same_scope_content() {
        assert_eq!(id(MemoryScope::Global, "hello"), id(MemoryScope::Global, "hello"));
        assert_ne!(id(MemoryScope::Global, "hello"), id(MemoryScope::Workspace, "hello"));
    }
}

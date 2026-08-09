//! Agent registry (R28 #2): manages every defined agent across sources.
//! Mirrors 's ServerRegistry (thread-safe) and Flock's ToolRegistry.
//! The core is pure (HashMap + merge logic, unit-tested); filesystem loading
//! and persistence are thin helpers layered on top.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use super::agent_def::{AgentDef, AgentId};

/// Where an agent definition came from (drives override precedence).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentSource {
    BuiltIn,
    Workspace(PathBuf),
    User(PathBuf),
    SkillDerived(AgentId),
}

#[derive(Debug, Default)]
pub struct AgentRegistry {
    agents: RwLock<HashMap<AgentId, AgentDef>>,
    sources: RwLock<HashMap<AgentId, AgentSource>>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a registry from the merged multi-source agent sets.
    pub fn from_defs(defs: impl IntoIterator<Item = (AgentDef, AgentSource)>) -> Self {
        let mut agents = HashMap::new();
        let mut sources = HashMap::new();
        for (def, source) in defs {
            let id = def.id.clone();
            agents.insert(id.clone(), def);
            sources.insert(id, source);
        }
        Self {
            agents: RwLock::new(agents),
            sources: RwLock::new(sources),
        }
    }

    pub fn get(&self, id: &AgentId) -> Option<AgentDef> {
        self.agents
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }

    pub fn source_of(&self, id: &AgentId) -> Option<AgentSource> {
        self.sources
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }

    pub fn all(&self) -> Vec<AgentDef> {
        let mut out: Vec<AgentDef> = self
            .agents
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Delegatable workers: enabled, subagent-mode, not hidden.
    pub fn list_delegatable(&self) -> Vec<AgentDef> {
        let mut out: Vec<AgentDef> = self
            .agents
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .filter(|a| a.is_delegatable())
            .cloned()
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// Main-chat pickers: enabled, primary-mode.
    pub fn list_primary(&self) -> Vec<AgentDef> {
        let mut out: Vec<AgentDef> = self
            .agents
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .filter(|a| a.is_primary())
            .cloned()
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// Register or override an agent (user creation / skill derivation).
    pub fn register(&self, def: AgentDef, source: AgentSource) {
        let id = def.id.clone();
        self.agents
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.clone(), def);
        self.sources
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, source);
    }

    pub fn remove(&self, id: &AgentId) {
        self.agents
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        self.sources
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }

    /// Merge built-in and user agents: a user agent with the same `id`
    /// overrides the built-in (higher precedence wins); otherwise appended.
    /// Pure — unit-tested.
    pub fn merge(built_in: Vec<AgentDef>, user: Vec<AgentDef>) -> Vec<AgentDef> {
        let mut by_id: HashMap<AgentId, AgentDef> = HashMap::new();
        for def in built_in {
            by_id.insert(def.id.clone(), def);
        }
        for def in user {
            by_id.insert(def.id.clone(), def);
        }
        let mut out: Vec<AgentDef> = by_id.into_values().collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

/// Directory where user agents live: `<data>/agents/`.
pub fn user_agents_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("agents")
}

/// Directory where workspace agents live: `<workspace>/.yamet/agents/`.
pub fn workspace_agents_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".yamet").join("agents")
}

/// Load all `<dir>/*.json` as agent definitions, ignoring unreadable files.
/// Returns the parsed defs with their source path.
pub fn load_agents_from_dir(dir: &Path, source: AgentSource) -> Vec<AgentDef> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if let Ok(def) = serde_json::from_slice::<AgentDef>(&bytes) {
            out.push(def);
        }
    }
    let _ = source; // caller records source in the registry
    out
}

/// Persist an agent definition to `<dir>/<id>.json` (atomic write).
pub fn persist_agent(dir: &Path, def: &AgentDef) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut name = def.id.clone();
    name.retain(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if name.is_empty() {
        return Err("agent id must produce a safe filename".into());
    }
    let path = dir.join(format!("{name}.json"));
    let bytes = serde_json::to_vec_pretty(def).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{name}.json.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::ai::agents::agent_def::AgentMode;

    fn def(id: &str, mode: AgentMode) -> AgentDef {
        AgentDef {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            system_prompt: "p".into(),
            mode,
            ..Default::default()
        }
    }

    #[test]
    fn get_returns_clone() {
        let reg = AgentRegistry::from_defs([(def("a", AgentMode::Subagent), AgentSource::BuiltIn)]);
        assert!(reg.get(&"a".to_string()).is_some());
        assert!(reg.get(&"b".to_string()).is_none());
    }

    #[test]
    fn delegatable_filters_by_mode_and_enabled() {
        let reg = AgentRegistry::from_defs([
            (def("sub", AgentMode::Subagent), AgentSource::BuiltIn),
            (def("primary", AgentMode::Primary), AgentSource::BuiltIn),
            (def("hidden", AgentMode::Hidden), AgentSource::BuiltIn),
        ]);
        let delegatable = reg.list_delegatable();
        assert_eq!(delegatable.len(), 1);
        assert_eq!(delegatable[0].id, "sub");
        let primary = reg.list_primary();
        assert_eq!(primary.len(), 1);
        assert_eq!(primary[0].id, "primary");
    }

    #[test]
    fn register_overrides_and_tracks_source() {
        let reg = AgentRegistry::new();
        reg.register(
            def("a", AgentMode::Subagent),
            AgentSource::User(PathBuf::from("/u")),
        );
        assert_eq!(reg.source_of(&"a".to_string()), Some(AgentSource::User(PathBuf::from("/u"))));
        reg.register(def("a", AgentMode::Primary), AgentSource::SkillDerived("s".into()));
        assert_eq!(reg.get(&"a".to_string()).unwrap().mode, AgentMode::Primary);
        reg.remove(&"a".to_string());
        assert!(reg.get(&"a".to_string()).is_none());
    }

    #[test]
    fn merge_user_overrides_builtin_by_id() {
        let built = vec![def("a", AgentMode::Subagent), def("b", AgentMode::Primary)];
        let user = vec![AgentDef {
            name: "custom a".into(),
            ..def("a", AgentMode::Hidden)
        }];
        let merged = AgentRegistry::merge(built, user);
        assert_eq!(merged.len(), 2);
        let a = merged.iter().find(|d| d.id == "a").unwrap();
        assert_eq!(a.name, "custom a");
        assert_eq!(a.mode, AgentMode::Hidden);
    }

    #[test]
    fn persist_roundtrips_through_dir() {
        let dir = std::env::temp_dir().join(format!("yamet-agents-{}", std::process::id()));
        let reg_def = def("test-agent", AgentMode::Subagent);
        persist_agent(&dir, &reg_def).unwrap();
        let loaded = load_agents_from_dir(&dir, AgentSource::User(dir.clone()));
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test-agent");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

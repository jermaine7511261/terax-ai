use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct HubSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub tags: Vec<String>,
    pub installs: u64,
    pub rating: f64,
    pub source_url: Option<String>,
    pub instructions: String,
    pub updated_at: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub tags: Vec<String>,
    pub installed_at: String,
    pub updated_at: String,
    pub instructions: String,
    pub enabled: bool,
    pub source_url: Option<String>,
}

pub struct SkillsHub {
    registry: Mutex<HashMap<String, InstalledSkill>>,
    remote_index: Mutex<Vec<HubSkill>>,
    base_dir: Mutex<Option<PathBuf>>,
}

impl Default for SkillsHub {
    fn default() -> Self {
        Self {
            registry: Mutex::new(HashMap::new()),
            remote_index: Mutex::new(Vec::new()),
            base_dir: Mutex::new(None),
        }
    }
}

impl SkillsHub {
    pub fn new() -> Self { Self::default() }

    pub fn init(&self, base_dir: &std::path::Path) -> Result<(), String> {
        let skills_dir = base_dir.join("hub").join("skills");
        std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
        *self.base_dir.lock().map_err(|e| e.to_string())? = Some(skills_dir.clone());
        self.load_installed()
    }

    fn load_installed(&self) -> Result<(), String> {
        let dir = self.base_dir.lock().map_err(|e| e.to_string())?.clone();
        let Some(dir) = dir else { return Ok(()) };
        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        registry.clear();
        if !dir.exists() { return Ok(()); }
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") { continue; }
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(skill) = serde_json::from_str::<InstalledSkill>(&content) {
                    registry.insert(skill.id.clone(), skill);
                }
            }
        }
        Ok(())
    }

    pub fn refresh_remote_index(&self) -> Result<Vec<HubSkill>, String> {
        // Simulated remote index — in production this fetches from a URL
        let builtin = get_builtin_skills();
        let mut index = self.remote_index.lock().map_err(|e| e.to_string())?;
        *index = builtin.clone();
        Ok(builtin)
    }

    pub fn search_remote(&self, query: &str) -> Result<Vec<HubSkill>, String> {
        let index = self.remote_index.lock().map_err(|e| e.to_string())?;
        let q = query.to_lowercase();
        Ok(index.iter()
            .filter(|s| {
                s.name.to_lowercase().contains(&q)
                || s.description.to_lowercase().contains(&q)
                || s.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .cloned().collect())
    }

    pub fn install_skill(&self, skill_id: &str) -> Result<InstalledSkill, String> {
        let index = self.remote_index.lock().map_err(|e| e.to_string())?;
        let remote = index.iter().find(|s| s.id == skill_id)
            .ok_or_else(|| format!("Skill not found in index: {skill_id}"))?;

        let now = iso_now();
        let installed = InstalledSkill {
            id: remote.id.clone(),
            name: remote.name.clone(),
            description: remote.description.clone(),
            category: remote.category.clone(),
            version: remote.version.clone(),
            author: remote.author.clone(),
            license: remote.license.clone(),
            tags: remote.tags.clone(),
            installed_at: now.clone(),
            updated_at: now,
            instructions: remote.instructions.clone(),
            enabled: true,
            source_url: remote.source_url.clone(),
        };

        let dir = self.base_dir.lock().map_err(|e| e.to_string())?.clone();
        let Some(dir) = dir else { return Err("Hub not initialized".into()) };
        let path = dir.join(format!("{}.json", remote.id));
        let json = serde_json::to_string_pretty(&installed).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())?;

        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        registry.insert(installed.id.clone(), installed.clone());
        Ok(installed)
    }

    pub fn uninstall_skill(&self, id: &str) -> Result<(), String> {
        let dir = self.base_dir.lock().map_err(|e| e.to_string())?.clone();
        if let Some(dir) = dir {
            let path = dir.join(format!("{id}.json"));
            let _ = std::fs::remove_file(&path);
        }
        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        registry.remove(id);
        Ok(())
    }

    pub fn list_installed(&self) -> Result<Vec<InstalledSkill>, String> {
        let registry = self.registry.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<InstalledSkill> = registry.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(list)
    }

    pub fn get_installed(&self, id: &str) -> Result<Option<InstalledSkill>, String> {
        Ok(self.registry.lock().map_err(|e| e.to_string())?.get(id).cloned())
    }

    pub fn toggle_skill(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        if let Some(skill) = registry.get_mut(id) {
            skill.enabled = enabled;
            skill.updated_at = iso_now();
            // Persist
            let dir = self.base_dir.lock().map_err(|e| e.to_string())?.clone();
            if let Some(dir) = dir {
                let path = dir.join(format!("{id}.json"));
                if let Ok(json) = serde_json::to_string_pretty(&skill) {
                    let _ = std::fs::write(&path, json);
                }
            }
        }
        Ok(())
    }
}

fn get_builtin_skills() -> Vec<HubSkill> {
    vec![
        HubSkill {
            id: "hub:code-review".into(), name: "Code Review Assistant".into(),
            description: "Automated code review with best-practice checks for multiple languages.".into(),
            category: "code-quality".into(), version: "2.1.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["review".into(), "lint".into(), "quality".into()],
            installs: 15420, rating: 4.8,
            source_url: Some("https://hub.terax.ai/skills/code-review".into()),
            instructions: "Analyze code changes for: correctness, security, performance, style. Focus on logic errors and edge cases. Skip formatting nits.".into(),
            updated_at: "2026-06-15".into(),
        },
        HubSkill {
            id: "hub:git-manager".into(), name: "Git Workflow Manager".into(),
            description: "Smart git workflow assistant — commit messages, branch management, rebase help.".into(),
            category: "devops".into(), version: "1.8.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["git".into(), "workflow".into(), "vcs".into()],
            installs: 12350, rating: 4.6,
            source_url: Some("https://hub.terax.ai/skills/git-manager".into()),
            instructions: "Help with git operations: write conventional commit messages, suggest branch names, resolve merge conflicts, manage stashes.".into(),
            updated_at: "2026-05-20".into(),
        },
        HubSkill {
            id: "hub:test-writer".into(), name: "Test Generator".into(),
            description: "Auto-generates unit/integration tests from source code analysis.".into(),
            category: "testing".into(), version: "1.5.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["test".into(), "unit".into(), "coverage".into()],
            installs: 9870, rating: 4.5,
            source_url: Some("https://hub.terax.ai/skills/test-writer".into()),
            instructions: "Read source files and generate comprehensive test suites. Cover edge cases, error paths, and main success scenarios.".into(),
            updated_at: "2026-04-10".into(),
        },
        HubSkill {
            id: "hub:refactor".into(), name: "Refactoring Engine".into(),
            description: "Suggests and executes safe refactoring patterns across codebases.".into(),
            category: "code-quality".into(), version: "2.0.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["refactor".into(), "clean-code".into(), "patterns".into()],
            installs: 7650, rating: 4.7,
            source_url: Some("https://hub.terax.ai/skills/refactor".into()),
            instructions: "Identify refactoring opportunities: extract function, rename, move to module, introduce pattern. Verify correctness after each change.".into(),
            updated_at: "2026-06-01".into(),
        },
        HubSkill {
            id: "hub:security-audit".into(), name: "Security Auditor".into(),
            description: "Deep security audit for OWASP Top 10, dependency CVEs, and secret leakage.".into(),
            category: "security".into(), version: "1.9.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["security".into(), "audit".into(), "cve".into()],
            installs: 6540, rating: 4.9,
            source_url: Some("https://hub.terax.ai/skills/security-audit".into()),
            instructions: "Audit for: SQL injection, XSS, CSRF, path traversal, auth bypass, secret exposure, dependency vulnerabilities. Report severity and fix.".into(),
            updated_at: "2026-06-10".into(),
        },
        HubSkill {
            id: "hub:docs-generator".into(), name: "Documentation Writer".into(),
            description: "Generates API docs, README files, and inline documentation from code.".into(),
            category: "documentation".into(), version: "1.3.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["docs".into(), "api".into(), "readme".into()],
            installs: 5430, rating: 4.4,
            source_url: Some("https://hub.terax.ai/skills/docs-generator".into()),
            instructions: "Read source code and generate: JSDoc/TSDoc comments, README sections, API reference docs. Follow existing doc style.".into(),
            updated_at: "2026-03-25".into(),
        },
        HubSkill {
            id: "hub:db-optimizer".into(), name: "Database Optimizer".into(),
            description: "Analyzes SQL queries, suggests indexes, and optimizes schema design.".into(),
            category: "database".into(), version: "1.2.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["database".into(), "sql".into(), "performance".into()],
            installs: 4320, rating: 4.3,
            source_url: Some("https://hub.terax.ai/skills/db-optimizer".into()),
            instructions: "Analyze SQL queries for: full table scans, missing indexes, N+1 patterns, connection pooling. Suggest schema migrations.".into(),
            updated_at: "2026-02-14".into(),
        },
        HubSkill {
            id: "hub:docker-compose".into(), name: "Docker Compose Manager".into(),
            description: "Creates and optimizes Dockerfiles and docker-compose configurations.".into(),
            category: "devops".into(), version: "1.1.0".into(), author: "Terax Hub".into(),
            license: "MIT".into(), tags: vec!["docker".into(), "compose".into(), "container".into()],
            installs: 3890, rating: 4.2,
            source_url: Some("https://hub.terax.ai/skills/docker-compose".into()),
            instructions: "Create multi-stage Dockerfiles, optimize layer caching, set up docker-compose for dev/test/prod environments.".into(),
            updated_at: "2026-01-30".into(),
        },
    ]
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;
    let s = secs % 60;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", 1970 + days / 365, (days % 365) / 30 + 1, days % 30 + 1, hours, mins, s)
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn hub_refresh(hub: tauri::State<'_, SkillsHub>) -> Result<Vec<HubSkill>, String> {
    hub.refresh_remote_index()
}

#[tauri::command]
pub fn hub_search(hub: tauri::State<'_, SkillsHub>, query: String) -> Result<Vec<HubSkill>, String> {
    hub.search_remote(&query)
}

#[tauri::command]
pub fn hub_install(hub: tauri::State<'_, SkillsHub>, skill_id: String) -> Result<InstalledSkill, String> {
    hub.install_skill(&skill_id)
}

#[tauri::command]
pub fn hub_uninstall(hub: tauri::State<'_, SkillsHub>, id: String) -> Result<(), String> {
    hub.uninstall_skill(&id)
}

#[tauri::command]
pub fn hub_list_installed(hub: tauri::State<'_, SkillsHub>) -> Result<Vec<InstalledSkill>, String> {
    hub.list_installed()
}

#[tauri::command]
pub fn hub_get_installed(hub: tauri::State<'_, SkillsHub>, id: String) -> Result<Option<InstalledSkill>, String> {
    hub.get_installed(&id)
}

#[tauri::command]
pub fn hub_toggle(hub: tauri::State<'_, SkillsHub>, id: String, enabled: bool) -> Result<(), String> {
    hub.toggle_skill(&id, enabled)
}

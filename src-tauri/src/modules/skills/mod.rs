use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct SkillDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub instructions: String,
    pub version: String,
    pub usage_count: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Default)]
pub struct SkillsEngine {
    skills: Mutex<HashMap<String, SkillDef>>,
    skills_dir: Mutex<Option<PathBuf>>,
}

impl SkillsEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn init(&self, base_dir: &std::path::Path) -> Result<(), String> {
        let skills_dir = base_dir.join("skills");
        std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
        *self.skills_dir.lock().map_err(|e| e.to_string())? = Some(skills_dir);
        self.load_all()
    }

    fn load_all(&self) -> Result<(), String> {
        let dir = self.skills_dir.lock().map_err(|e| e.to_string())?.clone();
        let Some(dir) = dir else { return Ok(()) };
        if !dir.exists() { return Ok(()); }
        let mut skills = self.skills.lock().map_err(|e| e.to_string())?;
        skills.clear();
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "md") { continue; }
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Some(skill) = parse_skill_md(&content, &path) {
                    skills.insert(skill.id.clone(), skill);
                }
            }
        }
        Ok(())
    }

    pub fn list_skills(&self) -> Result<Vec<SkillDef>, String> {
        let skills = self.skills.lock().map_err(|e| e.to_string())?;
        let mut list: Vec<SkillDef> = skills.values().cloned().collect();
        list.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
        Ok(list)
    }

    pub fn get_skill(&self, id: &str) -> Result<Option<SkillDef>, String> {
        let skills = self.skills.lock().map_err(|e| e.to_string())?;
        Ok(skills.get(id).cloned())
    }

    pub fn create_skill(&self, skill: SkillDef) -> Result<(), String> {
        let dir = self.skills_dir.lock().map_err(|e| e.to_string())?.clone();
        let Some(dir) = dir else { return Err("Skills directory not initialized".into()) };
        let path = dir.join(format!("{}.md", skill.id));
        let frontmatter = serde_json::to_string_pretty(&serde_json::json!({
            "id": skill.id,
            "name": skill.name,
            "description": skill.description,
            "category": skill.category,
            "version": skill.version,
            "created_at": skill.created_at,
            "updated_at": skill.updated_at,
        })).map_err(|e| e.to_string())?;
        let content = format!("---\n{}---\n\n{}", frontmatter, skill.instructions);
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
        let mut skills = self.skills.lock().map_err(|e| e.to_string())?;
        skills.insert(skill.id.clone(), skill);
        Ok(())
    }

    pub fn delete_skill(&self, id: &str) -> Result<(), String> {
        let dir = self.skills_dir.lock().map_err(|e| e.to_string())?.clone();
        let Some(dir) = dir else { return Err("Skills directory not initialized".into()) };
        let path = dir.join(format!("{}.md", id));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        let mut skills = self.skills.lock().map_err(|e| e.to_string())?;
        skills.remove(id);
        Ok(())
    }

    pub fn increment_usage(&self, id: &str) -> Result<(), String> {
        let mut skills = self.skills.lock().map_err(|e| e.to_string())?;
        if let Some(skill) = skills.get_mut(id) {
            skill.usage_count += 1;
            skill.updated_at = chrono_now();
        }
        Ok(())
    }
}

fn parse_skill_md(content: &str, _path: &PathBuf) -> Option<SkillDef> {
    let body = content.trim();
    let (frontmatter, instructions) = if body.starts_with("---") {
        let end = body[3..].find("---")?;
        let fm: &str = &body[3..3 + end];
        let instr = body[6 + end..].trim();
        (fm, instr)
    } else {
        ("{}", body)
    };
    let meta: serde_json::Value = serde_json::from_str(frontmatter).unwrap_or_default();
    Some(SkillDef {
        id: meta["id"].as_str().unwrap_or("unknown").to_string(),
        name: meta["name"].as_str().unwrap_or("Unnamed").to_string(),
        description: meta["description"].as_str().unwrap_or_default().to_string(),
        category: meta["category"].as_str().unwrap_or("general").to_string(),
        instructions: instructions.to_string(),
        version: meta["version"].as_str().unwrap_or("1.0.0").to_string(),
        usage_count: meta["usage_count"].as_u64().unwrap_or(0),
        created_at: meta["created_at"].as_str().unwrap_or("").to_string(),
        updated_at: meta["updated_at"].as_str().unwrap_or("").to_string(),
    })
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn skills_list(engine: State<'_, SkillsEngine>) -> Result<Vec<SkillDef>, String> {
    engine.list_skills()
}

#[tauri::command]
pub fn skills_get(engine: State<'_, SkillsEngine>, id: String) -> Result<Option<SkillDef>, String> {
    engine.get_skill(&id)
}

#[tauri::command]
pub fn skills_create(engine: State<'_, SkillsEngine>, skill: SkillDef) -> Result<(), String> {
    engine.create_skill(skill)
}

#[tauri::command]
pub fn skills_delete(engine: State<'_, SkillsEngine>, id: String) -> Result<(), String> {
    engine.delete_skill(&id)
}

#[tauri::command]
pub fn skills_use(engine: State<'_, SkillsEngine>, id: String) -> Result<(), String> {
    engine.increment_usage(&id)
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}", d.as_secs())
}

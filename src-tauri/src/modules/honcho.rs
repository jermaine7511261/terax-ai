use std::collections::HashMap;
use std::sync::Mutex;

// ─── User Profile (USER.md) ─────────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct UserProfile {
    pub name: String,
    pub role: String,
    pub preferences: HashMap<String, String>,
    pub model_preference: String,
    pub agent_mode: String,
    pub skill_auto_create: bool,
    pub learning_enabled: bool,
    pub memory_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub traits: Vec<UserTrait>,
    pub recent_goals: Vec<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct UserTrait {
    pub name: String,
    pub confidence: f64,
    pub observed_at: String,
    pub evidence: String,
}

impl Default for UserProfile {
    fn default() -> Self {
        Self {
            name: "User".into(),
            role: "developer".into(),
            preferences: HashMap::new(),
            model_preference: "auto".into(),
            agent_mode: "build".into(),
            skill_auto_create: true,
            learning_enabled: true,
            memory_enabled: true,
            created_at: chrono_now(),
            updated_at: chrono_now(),
            traits: Vec::new(),
            recent_goals: Vec::new(),
        }
    }
}

impl UserProfile {
    pub fn infer_trait(&mut self, observation: &str, category: &str) {
        let existing = self.traits.iter_mut().find(|t| t.name == category);
        if let Some(t) = existing {
            t.confidence = (t.confidence + 0.1).min(0.99);
            t.evidence = format!("{}; {}", t.evidence, observation);
            t.observed_at = chrono_now();
        } else {
            self.traits.push(UserTrait {
                name: category.into(),
                confidence: 0.3,
                observed_at: chrono_now(),
                evidence: observation.into(),
            });
        }
        self.updated_at = chrono_now();
    }

    pub fn record_goal(&mut self, goal: &str) {
        self.recent_goals.insert(0, goal.into());
        self.recent_goals.truncate(20);
    }

    pub fn to_markdown(&self) -> String {
        let mut md = String::new();
        md.push_str("---\n");
        md.push_str(&format!("name: {}\n", self.name));
        md.push_str(&format!("role: {}\n", self.role));
        md.push_str(&format!("model_preference: {}\n", self.model_preference));
        md.push_str(&format!("agent_mode: {}\n", self.agent_mode));
        md.push_str(&format!("skill_auto_create: {}\n", self.skill_auto_create));
        md.push_str(&format!("learning_enabled: {}\n", self.learning_enabled));
        md.push_str(&format!("memory_enabled: {}\n", self.memory_enabled));
        md.push_str("---\n\n## Traits\n\n");
        for t in &self.traits {
            md.push_str(&format!("- **{}** (confidence: {:.2}) — {}\n", t.name, t.confidence, t.evidence));
        }
        md.push_str("\n## Recent Goals\n\n");
        for g in &self.recent_goals {
            md.push_str(&format!("- {}\n", g));
        }
        md.push_str("\n## Preferences\n\n");
        for (k, v) in &self.preferences {
            md.push_str(&format!("- `{}`: {}\n", k, v));
        }
        md
    }
}

// ─── Honcho User Model ─────────────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct HonchoObservation {
    pub id: String,
    pub session_id: String,
    pub observation: String,
    pub category: String,
    pub weight: f64,
    pub timestamp: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct HonchoInsight {
    pub category: String,
    pub summary: String,
    pub confidence: f64,
    pub supporting_observations: Vec<String>,
    pub first_observed: String,
    pub last_observed: String,
}

pub struct HonchoEngine {
    observations: Mutex<Vec<HonchoObservation>>,
    profile: Mutex<UserProfile>,
}

impl Default for HonchoEngine {
    fn default() -> Self {
        Self {
            observations: Mutex::new(Vec::new()),
            profile: Mutex::new(UserProfile::default()),
        }
    }
}

impl HonchoEngine {
    pub fn new() -> Self { Self::default() }

    pub fn record_observation(&self, session_id: &str, observation: &str, category: &str) -> Result<(), String> {
        let mut obs = self.observations.lock().map_err(|e| e.to_string())?;
        let id = format!("obs-{}", obs.len() + 1);
        obs.push(HonchoObservation {
            id,
            session_id: session_id.into(),
            observation: observation.into(),
            category: category.into(),
            weight: 1.0,
            timestamp: chrono_now(),
        });
        if obs.len() > 1000 { obs.remove(0); }
        drop(obs);

        let mut profile = self.profile.lock().map_err(|e| e.to_string())?;
        profile.infer_trait(observation, category);
        Ok(())
    }

    pub fn get_insights(&self) -> Result<Vec<HonchoInsight>, String> {
        let obs = self.observations.lock().map_err(|e| e.to_string())?;
        let mut categories: HashMap<String, Vec<&HonchoObservation>> = HashMap::new();
        for o in obs.iter() {
            categories.entry(o.category.clone()).or_insert_with(Vec::new).push(o);
        }

        let mut insights = Vec::new();
        for (cat, items) in categories {
            let confidence = (items.len() as f64 * 0.1).min(0.95);
            let supporting: Vec<String> = items.iter().map(|o| o.observation.clone()).collect();
            let summary = format!("Observed {} times in category '{}'", items.len(), cat);
            insights.push(HonchoInsight {
                category: cat,
                summary,
                confidence,
                supporting_observations: supporting,
                first_observed: items.first().map(|o| o.timestamp.clone()).unwrap_or_default(),
                last_observed: items.last().map(|o| o.timestamp.clone()).unwrap_or_default(),
            });
        }
        insights.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
        Ok(insights)
    }

    pub fn get_profile(&self) -> Result<UserProfile, String> {
        self.profile.lock().map_err(|e| e.to_string()).map(|p| p.clone())
    }

    pub fn save_profile(&self, profile: UserProfile) -> Result<(), String> {
        let mut p = self.profile.lock().map_err(|e| e.to_string())?;
        *p = profile;
        Ok(())
    }

    pub fn record_goal(&self, goal: &str) -> Result<(), String> {
        let mut profile = self.profile.lock().map_err(|e| e.to_string())?;
        profile.record_goal(goal);
        Ok(())
    }

    pub fn get_profile_markdown(&self) -> Result<String, String> {
        self.profile.lock().map_err(|e| e.to_string()).map(|p| p.to_markdown())
    }
}

// ─── Memory Snapshot ─────────────────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MemorySnapshot {
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub memory_count: usize,
    pub session_count: usize,
    pub skill_count: usize,
}

pub struct MemorySnapshotManager {
    snapshots: Mutex<Vec<MemorySnapshot>>,
}

impl Default for MemorySnapshotManager {
    fn default() -> Self {
        Self { snapshots: Mutex::new(Vec::new()) }
    }
}

impl MemorySnapshotManager {
    pub fn new() -> Self { Self::default() }

    pub fn create_snapshot(&self, label: &str, memory_count: usize, session_count: usize, skill_count: usize) -> Result<MemorySnapshot, String> {
        let mut snapshots = self.snapshots.lock().map_err(|e| e.to_string())?;
        let snap = MemorySnapshot {
            id: format!("snap-{}", snapshots.len() + 1),
            label: label.into(),
            created_at: chrono_now(),
            memory_count,
            session_count,
            skill_count,
        };
        if snapshots.len() >= 20 { snapshots.remove(0); }
        snapshots.push(snap.clone());
        Ok(snap)
    }

    pub fn list_snapshots(&self) -> Result<Vec<MemorySnapshot>, String> {
        self.snapshots.lock().map_err(|e| e.to_string()).map(|s| s.clone())
    }

    pub fn delete_snapshot(&self, id: &str) -> Result<(), String> {
        let mut snapshots = self.snapshots.lock().map_err(|e| e.to_string())?;
        snapshots.retain(|s| s.id != id);
        Ok(())
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
}

// ─── Tauri Commands ───────────────────────────────────────────────────

// User Profile
#[tauri::command]
pub fn profile_get(honcho: tauri::State<'_, HonchoEngine>) -> Result<UserProfile, String> {
    honcho.get_profile()
}

#[tauri::command]
pub fn profile_save(honcho: tauri::State<'_, HonchoEngine>, profile: UserProfile) -> Result<(), String> {
    honcho.save_profile(profile)
}

#[tauri::command]
pub fn profile_get_markdown(honcho: tauri::State<'_, HonchoEngine>) -> Result<String, String> {
    honcho.get_profile_markdown()
}

#[tauri::command]
pub fn profile_record_goal(honcho: tauri::State<'_, HonchoEngine>, goal: String) -> Result<(), String> {
    honcho.record_goal(&goal)
}

// Honcho
#[tauri::command]
pub fn honcho_observe(honcho: tauri::State<'_, HonchoEngine>, session_id: String, observation: String, category: String) -> Result<(), String> {
    honcho.record_observation(&session_id, &observation, &category)
}

#[tauri::command]
pub fn honcho_insights(honcho: tauri::State<'_, HonchoEngine>) -> Result<Vec<HonchoInsight>, String> {
    honcho.get_insights()
}

// Memory Snapshot
#[tauri::command]
pub fn ms_create(snapper: tauri::State<'_, MemorySnapshotManager>, label: String, memory_count: usize, session_count: usize, skill_count: usize) -> Result<MemorySnapshot, String> {
    snapper.create_snapshot(&label, memory_count, session_count, skill_count)
}

#[tauri::command]
pub fn ms_list(snapper: tauri::State<'_, MemorySnapshotManager>) -> Result<Vec<MemorySnapshot>, String> {
    snapper.list_snapshots()
}

#[tauri::command]
pub fn ms_delete(snapper: tauri::State<'_, MemorySnapshotManager>, id: String) -> Result<(), String> {
    snapper.delete_snapshot(&id)
}

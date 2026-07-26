use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct TurnRecord {
    pub session_id: String,
    pub model_id: String,
    pub prompt_summary: String,
    pub response_summary: String,
    pub tools_used: Vec<String>,
    pub files_accessed: Vec<String>,
    pub errors: Vec<String>,
    pub timestamp: u64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ReviewResult {
    pub skill_id: Option<String>,
    pub skill_name: Option<String>,
    pub skill_instructions: Option<String>,
    pub insight: String,
    pub confidence: f64,
}

pub struct LearningEngine {
    turn_history: Mutex<Vec<TurnRecord>>,
    review_results: Mutex<Vec<ReviewResult>>,
    last_curator_run: Mutex<u64>,
    db: Mutex<Option<rusqlite::Connection>>,
    db_path: Mutex<Option<PathBuf>>,
}

impl Default for LearningEngine {
    fn default() -> Self {
        Self {
            turn_history: Mutex::new(Vec::new()),
            review_results: Mutex::new(Vec::new()),
            last_curator_run: Mutex::new(0),
            db: Mutex::new(None),
            db_path: Mutex::new(None),
        }
    }
}

impl LearningEngine {
    pub fn new() -> Self { Self::default() }

    pub fn init(&self, data_dir: &std::path::Path) -> Result<(), String> {
        let db_path = data_dir.join("learning.db");
        *self.db_path.lock().map_err(|e| e.to_string())? = Some(db_path.clone());
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS turn_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                model_id TEXT DEFAULT '',
                prompt_summary TEXT DEFAULT '',
                response_summary TEXT DEFAULT '',
                tools_used TEXT DEFAULT '',
                files_accessed TEXT DEFAULT '',
                errors TEXT DEFAULT '',
                timestamp INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS review_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id TEXT,
                skill_name TEXT,
                skill_instructions TEXT,
                insight TEXT DEFAULT '',
                confidence REAL DEFAULT 0.0
            );
            CREATE TABLE IF NOT EXISTS curator_state (
                key TEXT PRIMARY KEY,
                value TEXT DEFAULT ''
            );
        ").map_err(|e| e.to_string())?;
        *self.db.lock().map_err(|e| e.to_string())? = Some(conn);

        // Restore last curator run time
        if let Ok(conn) = self.db.lock() {
            if let Some(ref db) = *conn {
                if let Ok(mut stmt) = db.prepare("SELECT value FROM curator_state WHERE key = 'last_curator_run'") {
                    if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
                        for row in rows.flatten() {
                            if let Ok(ts) = row.parse::<u64>() {
                                *self.last_curator_run.lock().map_err(|e| e.to_string())? = ts;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn persist_turn(&self, record: &TurnRecord) {
        if let Ok(conn) = self.db.lock() {
            if let Some(ref db) = *conn {
                let _ = db.execute(
                    "INSERT INTO turn_history (session_id, model_id, prompt_summary, response_summary, tools_used, files_accessed, errors, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![record.session_id, record.model_id, record.prompt_summary, record.response_summary, record.tools_used.join(","), record.files_accessed.join(","), record.errors.join(";"), record.timestamp as i64],
                );
            }
        }
    }

    pub fn record_turn(&self, record: TurnRecord) -> Result<(), String> {
        let mut history = self.turn_history.lock().map_err(|e| e.to_string())?;
        if history.len() >= 500 { history.remove(0); }
        history.push(record.clone());
        self.persist_turn(&record);
        Ok(())
    }

    pub fn get_recent_turns(&self, session_id: &str, count: usize) -> Result<Vec<TurnRecord>, String> {
        let history = self.turn_history.lock().map_err(|e| e.to_string())?;
        let session_turns: Vec<TurnRecord> = history.iter().rev().filter(|t| t.session_id == session_id).take(count).cloned().collect();
        Ok(session_turns)
    }

    pub fn build_review_context(&self, session_id: &str) -> Result<String, String> {
        let turns = self.get_recent_turns(session_id, 10)?;
        if turns.is_empty() { return Ok(String::new()); }
        let mut lines = Vec::new();
        lines.push("<background_review_context>".to_string());
        lines.push(format!("session: {}", session_id));
        lines.push(format!("turns_reviewed: {}", turns.len()));
        for (i, t) in turns.iter().enumerate() {
            let tools = t.tools_used.join(", ");
            let files = t.files_accessed.join(", ");
            let errors = t.errors.join("; ");
            lines.push(format!(
                "turn[{}]: prompt=\"{}\" response=\"{}\" tools=[{}] files=[{}] errors=[{}]",
                i, truncate(&t.prompt_summary, 100), truncate(&t.response_summary, 100),
                tools, files, if errors.is_empty() { "none" } else { &errors },
            ));
        }
        lines.push("</background_review_context>".to_string());
        Ok(lines.join("\n"))
    }

    pub fn store_review_result(&self, result: ReviewResult) -> Result<(), String> {
        let mut results = self.review_results.lock().map_err(|e| e.to_string())?;
        results.push(result.clone());
        if results.len() > 200 { results.remove(0); }
        // Persist to DB
        if let Ok(conn) = self.db.lock() {
            if let Some(ref db) = *conn {
                let _ = db.execute(
                    "INSERT INTO review_results (skill_id, skill_name, skill_instructions, insight, confidence) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![result.skill_id, result.skill_name, result.skill_instructions, result.insight, result.confidence],
                );
            }
        }
        Ok(())
    }

    pub fn get_review_results(&self, count: usize) -> Result<Vec<ReviewResult>, String> {
        let guard = self.review_results.lock().map_err(|e| e.to_string())?;
        let results: Vec<ReviewResult> = guard.clone();
        drop(guard);
        if !results.is_empty() {
            return Ok(results.into_iter().rev().take(count).collect());
        }
        // If in-memory is empty, try DB
        let mut list = Vec::new();
        if let Ok(conn) = self.db.lock() {
            if let Some(ref db) = *conn {
                if let Ok(mut stmt) = db.prepare(
                    "SELECT skill_id, skill_name, skill_instructions, insight, confidence FROM review_results ORDER BY id DESC LIMIT ?1"
                ) {
                    if let Ok(rows) = stmt.query_map(rusqlite::params![count as i64], |r| {
                        Ok(ReviewResult {
                            skill_id: r.get(0)?,
                            skill_name: r.get(1)?,
                            skill_instructions: r.get(2)?,
                            insight: r.get(3)?,
                            confidence: r.get(4)?,
                        })
                    }) {
                        for row in rows.flatten() { list.push(row); }
                    }
                }
            }
        }
        Ok(list)
    }

    pub fn run_curator_cycle(&self) -> Result<Vec<String>, String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let seven_days: u64 = 7 * 24 * 60 * 60;
        let mut last_run = self.last_curator_run.lock().map_err(|e| e.to_string())?;
        if now.saturating_sub(*last_run) < seven_days { return Ok(Vec::new()); }
        *last_run = now;

        // Persist last run time
        if let Ok(conn) = self.db.lock() {
            if let Some(ref db) = *conn {
                let _ = db.execute(
                    "INSERT OR REPLACE INTO curator_state (key, value) VALUES ('last_curator_run', ?1)",
                    rusqlite::params![now.to_string()],
                );
            }
        }

        let mut archived = Vec::new();
        let results = self.review_results.lock().map_err(|e| e.to_string())?;

        let mut skill_usage: HashMap<String, u32> = HashMap::new();
        if let Ok(conn) = self.db.lock() {
            if let Some(ref db) = *conn {
                if let Ok(mut stmt) = db.prepare(
                    "SELECT prompt_summary || ' ' || response_summary FROM turn_history WHERE timestamp > ?1"
                ) {
                    let cutoff = now.saturating_sub(seven_days) as i64;
                    if let Ok(rows) = stmt.query_map(rusqlite::params![cutoff], |r| r.get::<_, String>(0)) {
                        for row in rows.flatten() {
                            for skill in results.iter() {
                                if let Some(ref name) = skill.skill_name {
                                    if row.to_lowercase().contains(&name.to_lowercase()) {
                                        *skill_usage.entry(name.clone()).or_insert(0) += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        for r in results.iter() {
            if let Some(ref sid) = r.skill_id {
                let used_recently = if let Some(ref name) = r.skill_name {
                    skill_usage.get(name).copied().unwrap_or(0) > 0
                } else { false };
                if !used_recently && r.confidence < 0.3 {
                    archived.push(sid.clone());
                }
            }
        }

        if !archived.is_empty() {
            log::info!("curator: archived {} skill(s): {:?}", archived.len(), archived);
        }
        Ok(archived)
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}…", &s[..max.saturating_sub(1)]) }
}

#[tauri::command]
pub fn learn_record_turn(engine: tauri::State<'_, LearningEngine>, record: TurnRecord) -> Result<(), String> {
    engine.record_turn(record)
}

#[tauri::command]
pub fn learn_build_review_context(engine: tauri::State<'_, LearningEngine>, session_id: String) -> Result<String, String> {
    engine.build_review_context(&session_id)
}

#[tauri::command]
pub fn learn_store_review_result(engine: tauri::State<'_, LearningEngine>, result: ReviewResult) -> Result<(), String> {
    engine.store_review_result(result)
}

#[tauri::command]
pub fn learn_get_review_results(engine: tauri::State<'_, LearningEngine>, count: Option<usize>) -> Result<Vec<ReviewResult>, String> {
    engine.get_review_results(count.unwrap_or(20))
}

#[tauri::command]
pub fn learn_run_curator(engine: tauri::State<'_, LearningEngine>) -> Result<Vec<String>, String> {
    engine.run_curator_cycle()
}

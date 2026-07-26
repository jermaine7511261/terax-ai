use std::sync::Mutex;
use rusqlite::{Connection, params};
use tauri::State;

pub struct MemoryDb {
    conn: Mutex<Connection>,
}

impl MemoryDb {
    pub fn new(db_path: &std::path::Path) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                title TEXT DEFAULT '',
                summary TEXT DEFAULT '',
                model_id TEXT DEFAULT ''
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
                title, summary, content,
                content='sessions',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
                INSERT INTO sessions_fts(rowid, title, summary, content)
                VALUES (new.rowid, new.title, new.summary, '');
            END;
            CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
                INSERT INTO sessions_fts(sessions_fts, rowid, title, summary, content)
                VALUES ('delete', old.rowid, old.title, old.summary, '');
            END;
            CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
                INSERT INTO sessions_fts(sessions_fts, rowid, title, summary, content)
                VALUES ('delete', old.rowid, old.title, old.summary, '');
                INSERT INTO sessions_fts(rowid, title, summary, content)
                VALUES (new.rowid, new.title, new.summary, '');
            END;

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content,
                content='messages',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content)
                VALUES (new.rowid, new.content);
            END;
            CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content)
                VALUES ('delete', old.rowid, old.content);
            END;

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                tags TEXT DEFAULT '',
                source TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                content, tags,
                content='memories',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, content, tags)
                VALUES (new.rowid, new.content, new.tags);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, tags)
                VALUES ('delete', old.rowid, old.content, old.tags);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, tags)
                VALUES ('delete', old.rowid, old.content, old.tags);
                INSERT INTO memories_fts(rowid, content, tags)
                VALUES (new.rowid, new.content, new.tags);
            END;
        ").map_err(|e| e.to_string())?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn search_sessions(&self, query: &str, limit: i64) -> Result<Vec<SessionRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("
            SELECT s.id, s.title, s.summary, s.created_at, s.model_id,
                   rank
            FROM sessions_fts
            JOIN sessions s ON s.rowid = sessions_fts.rowid
            WHERE sessions_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2
        ").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![query, limit as i64], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                summary: row.get(2)?,
                created_at: row.get(3)?,
                model_id: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn search_memories(&self, query: &str, limit: i64) -> Result<Vec<MemoryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("
            SELECT m.id, m.content, m.tags, m.source, m.created_at,
                   rank
            FROM memories_fts
            JOIN memories m ON m.rowid = memories_fts.rowid
            WHERE memories_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2
        ").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![query, limit as i64], |row| {
            Ok(MemoryRecord {
                id: row.get(0)?,
                content: row.get(1)?,
                tags: row.get(2)?,
                source: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| e.to_string())?);
        }
        Ok(results)
    }

    pub fn add_memory(&self, id: &str, content: &str, tags: &str, source: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO memories (id, content, tags, source) VALUES (?1, ?2, ?3, ?4)",
            params![id, content, tags, source],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_session(&self, id: &str, title: &str, summary: &str, model_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, title, summary, model_id) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, summary, model_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn memory_search(db: State<'_, MemoryDb>, query: String, limit: Option<i64>) -> Result<Vec<MemoryRecord>, String> {
    db.search_memories(&query, limit.unwrap_or(20))
}

#[tauri::command]
pub fn memory_add(db: State<'_, MemoryDb>, id: String, content: String, tags: String, source: String) -> Result<(), String> {
    db.add_memory(&id, &content, &tags, &source)
}

#[tauri::command]
pub fn memory_save_session(db: State<'_, MemoryDb>, id: String, title: String, summary: String, model_id: String) -> Result<(), String> {
    db.save_session(&id, &title, &summary, &model_id)
}

#[tauri::command]
pub fn memory_search_sessions(db: State<'_, MemoryDb>, query: String, limit: Option<i64>) -> Result<Vec<SessionRecord>, String> {
    db.search_sessions(&query, limit.unwrap_or(20))
}

// ─── Records ─────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub created_at: String,
    pub model_id: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct MemoryRecord {
    pub id: String,
    pub content: String,
    pub tags: String,
    pub source: String,
    pub created_at: String,
}

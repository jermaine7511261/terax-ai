use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChangeKind {
    Created,
    Modified,
    Deleted,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub timestamp: String,
    pub size_bytes: i64,
    pub hash: String,
}

pub struct Worktree {
    root: Mutex<Option<PathBuf>>,
    snapshot: Mutex<HashMap<String, (i64, String)>>,
    pending_changes: Mutex<Vec<FileChange>>,
    #[allow(dead_code)]
    debounce_ms: Mutex<u64>,
}

impl Default for Worktree {
    fn default() -> Self {
        Self {
            root: Mutex::new(None),
            snapshot: Mutex::new(HashMap::new()),
            pending_changes: Mutex::new(Vec::new()),
            debounce_ms: Mutex::new(300),
        }
    }
}

impl Worktree {
    pub fn new() -> Self { Self::default() }

    pub fn init(&self, root: &std::path::Path) {
        *self.root.lock().unwrap() = Some(root.to_path_buf());
    }

    fn ts() -> String {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
    }

    fn simple_hash(content: &[u8]) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        content.hash(&mut h);
        format!("{:x}", h.finish())
    }

    /// Take a snapshot of all files under root.
    pub fn snapshot(&self) -> Result<usize, String> {
        let root = self.root.lock().map_err(|e| e.to_string())?.clone();
        let Some(root) = root else { return Err("Worktree root not set".into()) };
        let mut snap = HashMap::new();
        let entries = walk_files(&root);
        for path in entries {
            if let Ok(meta) = std::fs::metadata(&path) {
                let size = meta.len() as i64;
                let hash = if let Ok(content) = std::fs::read(&path) {
                    Self::simple_hash(&content)
                } else { String::new() };
                snap.insert(path.to_string_lossy().to_string(), (size, hash));
            }
        }
        let count = snap.len();
        *self.snapshot.lock().map_err(|e| e.to_string())? = snap;
        Ok(count)
    }

    /// Diff current state against the last snapshot.
    pub fn diff(&self) -> Result<Vec<FileChange>, String> {
        let root = self.root.lock().map_err(|e| e.to_string())?.clone();
        let Some(root) = root else { return Err("Worktree root not set".into()) };
        let snap = self.snapshot.lock().map_err(|e| e.to_string())?;
        let now = Self::ts();
        let mut changes = Vec::new();

        // Check current files against snapshot
        let current_files = walk_files(&root);
        let current_set: std::collections::HashSet<String> = current_files.iter().map(|p| p.to_string_lossy().to_string()).collect();

        for path in &current_files {
            let path_str = path.to_string_lossy().to_string();
            if let Ok(meta) = std::fs::metadata(path) {
                let size = meta.len() as i64;
                let hash = if let Ok(content) = std::fs::read(path) {
                    Self::simple_hash(&content)
                } else { continue; };

                match snap.get(&path_str) {
                    Some((old_size, old_hash)) if *old_hash != hash => {
                        changes.push(FileChange {
                            path: path_str, kind: ChangeKind::Modified,
                            timestamp: now.clone(), size_bytes: size - old_size, hash,
                        });
                    }
                    None => {
                        changes.push(FileChange {
                            path: path_str, kind: ChangeKind::Created,
                            timestamp: now.clone(), size_bytes: size, hash,
                        });
                    }
                    _ => {}
                }
            }
        }

        // Detect deletions
        for (path, _) in snap.iter() {
            if !current_set.contains(path) {
                changes.push(FileChange {
                    path: path.clone(), kind: ChangeKind::Deleted,
                    timestamp: now.clone(), size_bytes: 0, hash: String::new(),
                });
            }
        }

        let mut pending = self.pending_changes.lock().map_err(|e| e.to_string())?;
        pending.extend(changes.clone());
        if pending.len() > 10000 {
            let end = pending.len() - 10000;
            pending.drain(0..end);
        }

        Ok(changes)
    }

    pub fn get_pending_changes(&self) -> Result<Vec<FileChange>, String> {
        let pending = self.pending_changes.lock().map_err(|e| e.to_string())?;
        let mut result = pending.clone();
        result.reverse();
        result.truncate(100);
        Ok(result)
    }

    pub fn clear_pending(&self) -> Result<(), String> {
        self.pending_changes.lock().map_err(|e| e.to_string())?.clear();
        Ok(())
    }
}

fn walk_files(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.starts_with('.') || name == "node_modules" || name == "target" { continue; }
                files.extend(walk_files(&path));
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files
}

#[tauri::command]
pub fn wt_snapshot(engine: tauri::State<'_, Worktree>) -> Result<usize, String> {
    engine.snapshot()
}

#[tauri::command]
pub fn wt_diff(engine: tauri::State<'_, Worktree>) -> Result<Vec<FileChange>, String> {
    engine.diff()
}

#[tauri::command]
pub fn wt_pending(engine: tauri::State<'_, Worktree>) -> Result<Vec<FileChange>, String> {
    engine.get_pending_changes()
}

#[tauri::command]
pub fn wt_clear(engine: tauri::State<'_, Worktree>) -> Result<(), String> {
    engine.clear_pending()
}

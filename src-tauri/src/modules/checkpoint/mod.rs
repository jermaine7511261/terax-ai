use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// A snapshot of file system state at a point in time.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub label: String,
    pub created_at: String,
    /// Number of files tracked in this checkpoint.
    pub file_count: usize,
}

/// Recorded file state within a checkpoint.
#[derive(Clone)]
struct FileState {
    path: PathBuf,
    content: Vec<u8>,
}

pub struct CheckpointManager {
    checkpoints: Mutex<Vec<Checkpoint>>,
    snapshots: Mutex<HashMap<String, Vec<FileState>>>,
    base_dir: Mutex<Option<PathBuf>>,
}

impl Default for CheckpointManager {
    fn default() -> Self {
        Self {
            checkpoints: Mutex::new(Vec::new()),
            snapshots: Mutex::new(HashMap::new()),
            base_dir: Mutex::new(None),
        }
    }
}

impl CheckpointManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn init(&self, base_dir: &std::path::Path) {
        *self.base_dir.lock().unwrap() = Some(base_dir.to_path_buf());
    }

    /// Create a checkpoint by snapshotting all files in the workspace.
    pub fn create_checkpoint(&self, label: &str) -> Result<Checkpoint, String> {
        let dir = self.base_dir.lock().map_err(|e| e.to_string())?.clone();
        let Some(dir) = dir else {
            return Err("Base directory not initialized".into());
        };

        let id = format!("cp-{}", chrono_now());
        let now = iso_now();
        let mut files = Vec::new();

        if dir.exists() {
            let entries = walk_files(&dir);
            for path in entries {
                if let Ok(content) = std::fs::read(&path) {
                    files.push(FileState { path, content });
                }
            }
        }

        let checkpoint = Checkpoint {
            id: id.clone(),
            label: label.to_string(),
            created_at: now,
            file_count: files.len(),
        };

        let mut checkpoints = self.checkpoints.lock().map_err(|e| e.to_string())?;
        let mut snapshots = self.snapshots.lock().map_err(|e| e.to_string())?;

        // Limit to 20 checkpoints
        if checkpoints.len() >= 20 {
            let removed = checkpoints.remove(0);
            snapshots.remove(&removed.id);
        }

        snapshots.insert(id.clone(), files);
        checkpoints.push(checkpoint.clone());
        Ok(checkpoint)
    }

    /// List all checkpoints.
    pub fn list_checkpoints(&self) -> Result<Vec<Checkpoint>, String> {
        self.checkpoints.lock().map_err(|e| e.to_string()).map(|c| c.clone())
    }

    /// Restore a checkpoint: overwrite current files with checkpoint state.
    pub fn restore_checkpoint(&self, id: &str) -> Result<usize, String> {
        let snapshots = self.snapshots.lock().map_err(|e| e.to_string())?;
        let Some(files) = snapshots.get(id) else {
            return Err(format!("Checkpoint not found: {id}"));
        };

        for file in files {
            if let Some(parent) = file.path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&file.path, &file.content);
        }

        Ok(files.len())
    }

    /// Delete a checkpoint.
    pub fn delete_checkpoint(&self, id: &str) -> Result<(), String> {
        let mut checkpoints = self.checkpoints.lock().map_err(|e| e.to_string())?;
        let mut snapshots = self.snapshots.lock().map_err(|e| e.to_string())?;
        checkpoints.retain(|c| c.id != id);
        snapshots.remove(id);
        Ok(())
    }
}

fn walk_files(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip hidden directories and node_modules
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
                files.extend(walk_files(&path));
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}", d.as_secs())
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    let millis = d.subsec_millis();
    // Simple ISO-like format
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;
    let secs = secs % 60;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", 1970 + days / 365, 1, 1, hours, mins, secs, millis)
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn checkpoint_create(
    manager: tauri::State<'_, CheckpointManager>,
    label: String,
) -> Result<Checkpoint, String> {
    manager.create_checkpoint(&label)
}

#[tauri::command]
pub fn checkpoint_list(
    manager: tauri::State<'_, CheckpointManager>,
) -> Result<Vec<Checkpoint>, String> {
    manager.list_checkpoints()
}

#[tauri::command]
pub fn checkpoint_restore(
    manager: tauri::State<'_, CheckpointManager>,
    id: String,
) -> Result<usize, String> {
    manager.restore_checkpoint(&id)
}

#[tauri::command]
pub fn checkpoint_delete(
    manager: tauri::State<'_, CheckpointManager>,
    id: String,
) -> Result<(), String> {
    manager.delete_checkpoint(&id)
}

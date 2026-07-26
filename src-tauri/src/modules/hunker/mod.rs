use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Hunk {
    pub id: String,
    pub file: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub content: String,
    pub timestamp: String,
    pub committed: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct HunkGroup {
    pub id: String,
    pub label: String,
    pub hunks: Vec<Hunk>,
    pub created_at: String,
    pub applied: bool,
}

pub struct HunkTracker {
    groups: Mutex<Vec<HunkGroup>>,
    next_id: Mutex<u64>,
}

impl Default for HunkTracker {
    fn default() -> Self {
        Self { groups: Mutex::new(Vec::new()), next_id: Mutex::new(1) }
    }
}

impl HunkTracker {
    pub fn new() -> Self { Self::default() }

    fn ts() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs().to_string()
    }

    pub fn record_hunks(&self, file: &str, old_content: &str, new_content: &str, label: &str) -> Result<HunkGroup, String> {
        let old_lines: Vec<&str> = old_content.lines().collect();
        let new_lines: Vec<&str> = new_content.lines().collect();
        let mut next = self.next_id.lock().map_err(|e| e.to_string())?;
        let group_id = format!("hg-{}", *next);
        *next += 1;
        drop(next);

        let diff = similar::TextDiff::from_lines(old_content, new_content);
        let diff_ops = diff.ops();
        let mut hunks = Vec::new();
        let now = Self::ts();

        for op in diff_ops.iter() {
            let (tag, old_range, new_range) = op.as_tag_tuple();
            match tag {
                similar::DiffTag::Equal => continue,
                _ => {
                    let old_slice: Vec<&str> = old_lines[old_range.start..old_range.end].to_vec();
                    let new_slice: Vec<&str> = new_lines[new_range.start..new_range.end].to_vec();
                    let mut content = String::new();
                    if !old_slice.is_empty() {
                        content.push_str(&format!("--- a/{}\n", file));
                        for l in &old_slice { content.push_str(&format!("-{}\n", l)); }
                    }
                    if !new_slice.is_empty() {
                        content.push_str(&format!("+++ b/{}\n", file));
                        for l in &new_slice { content.push_str(&format!("+{}\n", l)); }
                    }
                    hunks.push(Hunk {
                        id: format!("hunk-{}-{}", group_id, hunks.len() + 1),
                        file: file.into(),
                        old_start: old_range.start as u32 + 1,
                        old_lines: (old_range.end - old_range.start) as u32,
                        new_start: new_range.start as u32 + 1,
                        new_lines: (new_range.end - new_range.start) as u32,
                        content,
                        timestamp: now.clone(),
                        committed: false,
                    });
                }
            }
        }

        let group = HunkGroup {
            id: group_id,
            label: label.into(),
            hunks,
            created_at: now,
            applied: false,
        };

        let mut groups = self.groups.lock().map_err(|e| e.to_string())?;
        let result = group.clone();
        groups.push(group);
        if groups.len() > 200 { groups.remove(0); }
        Ok(result)
    }

    pub fn list_groups(&self) -> Result<Vec<HunkGroup>, String> {
        let groups = self.groups.lock().map_err(|e| e.to_string())?;
        let mut list = groups.clone();
        list.reverse();
        Ok(list)
    }

    pub fn get_group(&self, id: &str) -> Result<Option<HunkGroup>, String> {
        Ok(self.groups.lock().map_err(|e| e.to_string())?.iter().find(|g| g.id == id).cloned())
    }

    pub fn mark_applied(&self, id: &str) -> Result<(), String> {
        let mut groups = self.groups.lock().map_err(|e| e.to_string())?;
        if let Some(g) = groups.iter_mut().find(|g| g.id == id) { g.applied = true; }
        Ok(())
    }

    pub fn delete_group(&self, id: &str) -> Result<(), String> {
        let mut groups = self.groups.lock().map_err(|e| e.to_string())?;
        groups.retain(|g| g.id != id);
        Ok(())
    }

    pub fn cleanup_old(&self) -> Result<u32, String> {
        let mut groups = self.groups.lock().map_err(|e| e.to_string())?;
        let now_secs: u64 = Self::ts().parse().unwrap_or(0);
        let before = groups.len();
        groups.retain(|g| {
            if let Ok(ts) = g.created_at.parse::<u64>() {
                now_secs.saturating_sub(ts) < 86400 // keep 24h
            } else { true }
        });
        Ok((before - groups.len()) as u32)
    }
}

#[tauri::command]
pub fn hunk_record(
    tracker: tauri::State<'_, HunkTracker>,
    file: String, old_content: String, new_content: String, label: String,
) -> Result<HunkGroup, String> {
    tracker.record_hunks(&file, &old_content, &new_content, &label)
}

#[tauri::command]
pub fn hunk_list(tracker: tauri::State<'_, HunkTracker>) -> Result<Vec<HunkGroup>, String> {
    tracker.list_groups()
}

#[tauri::command]
pub fn hunk_get(tracker: tauri::State<'_, HunkTracker>, id: String) -> Result<Option<HunkGroup>, String> {
    tracker.get_group(&id)
}

#[tauri::command]
pub fn hunk_apply(tracker: tauri::State<'_, HunkTracker>, id: String) -> Result<(), String> {
    tracker.mark_applied(&id)
}

#[tauri::command]
pub fn hunk_delete(tracker: tauri::State<'_, HunkTracker>, id: String) -> Result<(), String> {
    tracker.delete_group(&id)
}

#[tauri::command]
pub fn hunk_cleanup(tracker: tauri::State<'_, HunkTracker>) -> Result<u32, String> {
    tracker.cleanup_old()
}

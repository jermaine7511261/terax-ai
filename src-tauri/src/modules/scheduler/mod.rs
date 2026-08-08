//! Cron scheduler (★ H3 Hermes). Tasks defined by a natural-language prompt +
//! a 5-field cron expression fire on schedule; the frontend listens for
//! `yamet:scheduler-fire` and spawns the agent (notification/session target).

mod cron;

use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use tauri::State;

use cron::{next_trigger, parse_cron};

// A minutely task's next trigger is at most 60s away; any wider cadence is a
// multiple of it, so a 60s window never misses a fire (and the tick loop
// runs every 30s, so a task fires within its window).
const TICK_WINDOW_SECS: i64 = 60;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    pub prompt: String,
    /// 5-field cron: `minute hour day-of-month month day-of-week`.
    pub cron: String,
    /// "notification" | "session"
    pub target: String,
    pub enabled: bool,
    /// Timestamp of the last trigger instant that was fired. Doubles as the
    /// dedup guard: the same trigger instant stays inside the 60s tick window
    /// across several 30s ticks, so `tick()` only fires when a trigger is
    /// strictly newer than this.
    pub last_fired_at: Option<i64>,
}

/// Emitted to the frontend when a task fires.
#[derive(Clone, Serialize)]
pub struct FiredTask {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub target: String,
}

#[derive(Default)]
pub struct SchedulerState {
    tasks: RwLock<Vec<ScheduledTask>>,
    persist_path: Mutex<Option<PathBuf>>,
}

impl SchedulerState {
    pub fn set_persist_path(&self, path: PathBuf) {
        *self.persist_path.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
    }

    pub fn load(&self) {
        let Some(path) = self.persist_path.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
            return;
        };
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(tasks) = serde_json::from_str::<Vec<ScheduledTask>>(&json) {
                *self.tasks.write().unwrap_or_else(|e| e.into_inner()) = tasks;
            }
        }
    }

    fn save(&self) {
        let Some(path) = self.persist_path.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
            return;
        };
        let json = serde_json::to_string(&*self.tasks.read().unwrap_or_else(|e| e.into_inner())).unwrap_or_default();
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(PathBuf::new().as_path()));
        // Atomic write (tmp + rename) so a crash mid-write can't leave a
        // truncated scheduler.json that silently drops every task on next load.
        let _ = atomic_write(&path, json.as_bytes());
    }

    /// Fire every enabled task whose next trigger falls inside the tick
    /// window; updates `last_fired_at` and persists.
    pub fn tick(&self) -> Vec<FiredTask> {
        let now: DateTime<Local> = Local::now();
        // Snapshot the enabled tasks under a read lock, then compute the
        // expensive `next_trigger` scan OUTSIDE any lock. An unsatisfiable cron
        // expression scans up to a 5-year horizon minute-by-minute (~2.6M
        // iterations); doing that while holding the write lock would block
        // scheduler_upsert/list/delete/toggle for the duration. This keeps the
        // write lock held only briefly, to apply last_fired_at updates.
        let snapshot: Vec<(String, String, String, String, String, i64)> = {
            let tasks = self.tasks.read().unwrap_or_else(|e| e.into_inner());
            tasks
                .iter()
                .filter(|t| t.enabled)
                .map(|t| {
                    (
                        t.id.clone(),
                        t.name.clone(),
                        t.prompt.clone(),
                        t.target.clone(),
                        t.cron.clone(),
                        t.last_fired_at.unwrap_or(0),
                    )
                })
                .collect()
        };

        let mut fired = Vec::new();
        let mut to_update: Vec<(String, i64)> = Vec::new();
        for (id, name, prompt, target, cron_str, last) in snapshot {
            let Ok(cron) = parse_cron(&cron_str) else {
                continue;
            };
            let Some(next) = next_trigger(&cron, now) else {
                continue;
            };
            let next_ts = next.timestamp();
            // Dedup guard: the same trigger instant stays inside the 60s tick
            // window across several 30s ticks, so a minutely task would fire on
            // every tick (2x/min) and a daily task twice around its trigger time.
            // Only fire when the trigger is strictly newer than the last one fired.
            if next_ts <= last {
                continue;
            }
            let delta = (next - now).num_seconds();
            if (0..=TICK_WINDOW_SECS).contains(&delta) {
                fired.push(FiredTask {
                    id: id.clone(),
                    name,
                    prompt,
                    target,
                });
                to_update.push((id, next_ts));
            }
        }

        if !to_update.is_empty() {
            {
                let mut tasks = self.tasks.write().unwrap_or_else(|e| e.into_inner());
                for (id, ts) in &to_update {
                    if let Some(task) = tasks.iter_mut().find(|t| t.id == *id) {
                        task.last_fired_at = Some(*ts);
                    }
                }
            }
            self.save();
        }
        fired
    }
}

fn list_inner(state: &SchedulerState) -> Vec<ScheduledTask> {
    state.tasks.read().unwrap_or_else(|e| e.into_inner()).clone()
}

fn upsert_inner(state: &SchedulerState, task: ScheduledTask) -> Result<(), String> {
    if task.name.trim().is_empty() || task.prompt.trim().is_empty() {
        return Err("task requires a name and prompt".into());
    }
    if !["notification", "session"].contains(&task.target.as_str()) {
        return Err("target must be notification or session".into());
    }
    parse_cron(&task.cron).map_err(|e| format!("bad cron: {e}"))?;
    {
        let mut tasks = state.tasks.write().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = tasks.iter_mut().find(|t| t.id == task.id) {
            *existing = task;
        } else {
            tasks.push(task);
        }
    }
    state.save();
    Ok(())
}

fn delete_inner(state: &SchedulerState, id: String) {
    state.tasks.write().unwrap_or_else(|e| e.into_inner()).retain(|t| t.id != id);
    state.save();
}

fn toggle_inner(state: &SchedulerState, id: String, enabled: bool) {
    if let Some(task) = state.tasks.write().unwrap_or_else(|e| e.into_inner()).iter_mut().find(|t| t.id == id) {
        task.enabled = enabled;
    }
    state.save();
}

#[tauri::command]
pub fn scheduler_list(state: State<'_, SchedulerState>) -> Vec<ScheduledTask> {
    list_inner(state.inner())
}

#[tauri::command]
pub fn scheduler_upsert(state: State<'_, SchedulerState>, task: ScheduledTask) -> Result<(), String> {
    upsert_inner(state.inner(), task)
}

#[tauri::command]
pub fn scheduler_delete(state: State<'_, SchedulerState>, id: String) {
    delete_inner(state.inner(), id);
}

#[tauri::command]
pub fn scheduler_toggle(state: State<'_, SchedulerState>, id: String, enabled: bool) {
    toggle_inner(state.inner(), id, enabled);
}

/// Write `bytes` to `path` atomically: write a sibling tmp file, fsync it, then
/// rename over the target. On Windows `std::fs::rename` refuses to overwrite an
/// existing target, so fall back to remove+rename (still safer than an in-place
/// truncating write: the target is never observed half-written).
fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::remove_file(path)?;
            std::fs::rename(&tmp, path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn upsert_validates_and_persists() {
        let state = SchedulerState::default();
        let tmp = TempDir::new().unwrap();
        state.set_persist_path(tmp.path().join("scheduler.json"));

        let task = ScheduledTask {
            id: "t1".into(),
            name: "每日报告".into(),
            prompt: "写一份今日进展摘要".into(),
            cron: "0 9 * * *".into(),
            target: "notification".into(),
            enabled: true,
            last_fired_at: None,
        };
        assert!(upsert_inner(&state, task.clone()).is_ok());

        // Invalid cron / target / empty fields are rejected.
        let mut bad = task.clone();
        bad.cron = "61 * * * *".into();
        assert!(upsert_inner(&state, bad).is_err());
        let mut bad = task.clone();
        bad.target = "im".into();
        assert!(upsert_inner(&state, bad).is_err());
        let mut bad = task.clone();
        bad.prompt = " ".into();
        assert!(upsert_inner(&state, bad).is_err());

        assert_eq!(list_inner(&state).len(), 1);
        // Persisted on disk.
        assert!(tmp.path().join("scheduler.json").exists());
    }

    #[test]
    fn delete_and_toggle() {
        let state = SchedulerState::default();
        let task = ScheduledTask {
            id: "t2".into(),
            name: "n".into(),
            prompt: "p".into(),
            cron: "* * * * *".into(),
            target: "session".into(),
            enabled: true,
            last_fired_at: None,
        };
        upsert_inner(&state, task.clone()).unwrap();

        toggle_inner(&state, "t2".into(), false);
        assert!(!list_inner(&state)[0].enabled);

        delete_inner(&state, "t2".into());
        assert!(list_inner(&state).is_empty());
    }

    #[test]
    fn tick_fires_minutely_task_within_window() {
        let state = SchedulerState::default();
        let task = ScheduledTask {
            id: "t3".into(),
            name: "n".into(),
            prompt: "p".into(),
            cron: "* * * * *".into(),
            target: "notification".into(),
            enabled: true,
            last_fired_at: None,
        };
        upsert_inner(&state, task).unwrap();

        let fired = state.tick();
        assert!(!fired.is_empty());
        assert_eq!(fired[0].id, "t3");
        // last_fired_at recorded after tick.
        assert!(list_inner(&state)[0].last_fired_at.is_some());
    }

    #[test]
    fn tick_skips_disabled_tasks() {
        let state = SchedulerState::default();
        let task = ScheduledTask {
            id: "t4".into(),
            name: "n".into(),
            prompt: "p".into(),
            cron: "* * * * *".into(),
            target: "session".into(),
            enabled: false,
            last_fired_at: None,
        };
        upsert_inner(&state, task).unwrap();
        assert!(state.tick().is_empty());
    }
    #[test]
    fn tick_does_not_double_fire_same_trigger() {
        // Regression: with a 30s tick loop and a 60s window, two ticks can
        // land before the SAME trigger instant. The dedup guard (next_ts > last)
        // must make the second tick a no-op — otherwise a minutely task fires
        // twice per minute and a daily task twice around its trigger time.
        let state = SchedulerState::default();
        let task = ScheduledTask {
            id: "t5".into(),
            name: "n".into(),
            prompt: "p".into(),
            cron: "* * * * *".into(),
            target: "notification".into(),
            enabled: true,
            last_fired_at: None,
        };
        upsert_inner(&state, task).unwrap();

        // First tick fires the imminent minute boundary and records it.
        let first = state.tick();
        assert_eq!(first.len(), 1);
        let recorded = list_inner(&state)[0].last_fired_at.unwrap();

        // A second tick within the same window must not fire the same trigger.
        let second = state.tick();
        assert!(second.is_empty(), "same trigger instant must not fire twice");
        assert_eq!(list_inner(&state)[0].last_fired_at.unwrap(), recorded);

        // Deterministic variant: seed last_fired_at far in the future (beyond any
        // 60s trigger window) — must be skipped regardless of wall-clock timing.
        let now = Local::now();
        let boundary = now.timestamp() + 120; // 2min ahead: far beyond any 60s trigger window
        {
            let mut tasks = state.tasks.write().unwrap_or_else(|e| e.into_inner());
            tasks[0].last_fired_at = Some(boundary);
        }
        assert!(state.tick().is_empty());
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_tmp() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("scheduler.json");

        atomic_write(&path, b"{\"v\":1}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"v\":1}");

        // Overwrite on top of an existing file (exercises the Windows fallback).
        atomic_write(&path, b"{\"v\":2}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"v\":2}");

        // No tmp residue.
        assert!(!path.with_extension("json.tmp").exists());
    }
}

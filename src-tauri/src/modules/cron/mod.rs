use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// A scheduled job definition.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub command: String,
    pub schedule: String,       // cron expression or "every X[m|h|d]"
    pub backend_id: String,     // which backend to run on
    pub work_dir: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub last_run_at: Option<String>,
    pub last_run_success: Option<bool>,
    pub run_count: u64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct CronRunLog {
    pub id: String,
    pub job_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub success: Option<bool>,
    pub output: String,
    pub error: String,
}

/// Parse simple schedule strings ("every 5m", "every 2h", "every 1d", "30m", "2h") into seconds.
fn parse_schedule_to_secs(schedule: &str) -> Option<u64> {
    let s = schedule.trim().to_lowercase();
    let s = s.strip_prefix("every ").unwrap_or(&s).trim();
    if let Some(rest) = s.strip_suffix("m") {
        rest.trim().parse::<u64>().ok().map(|v| v * 60)
    } else if let Some(rest) = s.strip_suffix("h") {
        rest.trim().parse::<u64>().ok().map(|v| v * 3600)
    } else if let Some(rest) = s.strip_suffix("d") {
        rest.trim().parse::<u64>().ok().map(|v| v * 86400)
    } else if let Some(rest) = s.strip_suffix("s") {
        rest.trim().parse::<u64>().ok()
    } else {
        s.parse::<u64>().ok().map(|v| v * 60) // bare number = minutes
    }
}

pub struct CronEngine {
    jobs: Mutex<Vec<CronJob>>,
    logs: Mutex<Vec<CronRunLog>>,
    last_check: Mutex<u64>,
    next_id: Mutex<u64>,
}

impl Default for CronEngine {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(Vec::new()),
            logs: Mutex::new(Vec::new()),
            last_check: Mutex::new(0),
            next_id: Mutex::new(1),
        }
    }
}

impl CronEngine {
    pub fn new() -> Self { Self::default() }

    fn now_secs() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
    }

    fn ts() -> String {
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        format!("{}", d.as_secs())
    }

    pub fn list_jobs(&self) -> Result<Vec<CronJob>, String> {
        self.jobs.lock().map_err(|e| e.to_string()).map(|j| j.clone())
    }

    pub fn add_job(&self, name: &str, command: &str, schedule: &str, backend_id: &str, work_dir: Option<&str>) -> Result<CronJob, String> {
        // Validate schedule
        if parse_schedule_to_secs(schedule).is_none() {
            return Err(format!("Invalid schedule format: '{schedule}'. Use 'every N[m|h|d]' or 'Nm'"));
        }
        let mut next = self.next_id.lock().map_err(|e| e.to_string())?;
        let id = format!("cron-{}", *next);
        *next += 1;
        let job = CronJob {
            id,
            name: name.into(),
            command: command.into(),
            schedule: schedule.into(),
            backend_id: backend_id.into(),
            work_dir: work_dir.map(|d| d.into()),
            enabled: true,
            created_at: Self::ts(),
            last_run_at: None,
            last_run_success: None,
            run_count: 0,
        };
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        jobs.push(job.clone());
        Ok(job)
    }

    pub fn update_job(&self, id: &str, name: Option<&str>, command: Option<&str>, schedule: Option<&str>, enabled: Option<bool>) -> Result<(), String> {
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs.iter_mut().find(|j| j.id == id).ok_or_else(|| format!("Job not found: {id}"))?;
        if let Some(n) = name { job.name = n.into(); }
        if let Some(c) = command { job.command = c.into(); }
        if let Some(s) = schedule {
            if parse_schedule_to_secs(s).is_none() {
                return Err(format!("Invalid schedule: '{s}'"));
            }
            job.schedule = s.into();
        }
        if let Some(e) = enabled { job.enabled = e; }
        Ok(())
    }

    pub fn delete_job(&self, id: &str) -> Result<(), String> {
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        jobs.retain(|j| j.id != id);
        Ok(())
    }

    pub fn record_run(&self, job_id: &str, success: bool, output: &str, error: &str) -> Result<(), String> {
        let mut logs = self.logs.lock().map_err(|e| e.to_string())?;
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        let now = Self::ts();
        let log_index = logs.len() + 1;
        logs.push(CronRunLog {
            id: format!("log-{}-{}", job_id, log_index),
            job_id: job_id.into(),
            started_at: now.clone(),
            finished_at: Some(now.clone()),
            success: Some(success),
            output: output.into(),
            error: error.into(),
        });
        if logs.len() > 1000 { logs.remove(0); }
        if let Some(job) = jobs.iter_mut().find(|j| j.id == job_id) {
            job.last_run_at = Some(now);
            job.last_run_success = Some(success);
            job.run_count += 1;
        }
        Ok(())
    }

    pub fn get_logs(&self, job_id: Option<&str>, limit: usize) -> Result<Vec<CronRunLog>, String> {
        let logs = self.logs.lock().map_err(|e| e.to_string())?;
        let filtered: Vec<CronRunLog> = match job_id {
            Some(id) => logs.iter().rev().filter(|l| l.job_id == id).take(limit).cloned().collect(),
            None => logs.iter().rev().take(limit).cloned().collect(),
        };
        Ok(filtered)
    }

    /// Tick: check which jobs are due. Call this periodically (every ~30s).
    /// Returns IDs of jobs that should be executed.
    pub fn tick(&self) -> Result<Vec<CronJob>, String> {
        let now = Self::now_secs();
        let mut last_check = self.last_check.lock().map_err(|e| e.to_string())?;
        let min_interval = (*last_check).max(now.saturating_sub(60));
        *last_check = now;
        drop(last_check);

        let jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        let mut due = Vec::new();

        for job in jobs.iter() {
            if !job.enabled { continue; }
            if let Some(secs) = parse_schedule_to_secs(&job.schedule) {
                let last_run = job.last_run_at.as_ref()
                    .and_then(|t| t.parse::<u64>().ok())
                    .unwrap_or(0);
                if now >= last_run + secs && last_run < min_interval {
                    due.push(job.clone());
                }
            }
        }
        Ok(due)
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn cron_list(engine: tauri::State<'_, CronEngine>) -> Result<Vec<CronJob>, String> {
    engine.list_jobs()
}

#[tauri::command]
pub fn cron_add(
    engine: tauri::State<'_, CronEngine>,
    name: String,
    command: String,
    schedule: String,
    backend_id: String,
    work_dir: Option<String>,
) -> Result<CronJob, String> {
    engine.add_job(&name, &command, &schedule, &backend_id, work_dir.as_deref())
}

#[tauri::command]
pub fn cron_update(
    engine: tauri::State<'_, CronEngine>,
    id: String,
    name: Option<String>,
    command: Option<String>,
    schedule: Option<String>,
    enabled: Option<bool>,
) -> Result<(), String> {
    engine.update_job(&id, name.as_deref(), command.as_deref(), schedule.as_deref(), enabled)
}

#[tauri::command]
pub fn cron_delete(engine: tauri::State<'_, CronEngine>, id: String) -> Result<(), String> {
    engine.delete_job(&id)
}

#[tauri::command]
pub fn cron_logs(engine: tauri::State<'_, CronEngine>, job_id: Option<String>, limit: Option<usize>) -> Result<Vec<CronRunLog>, String> {
    engine.get_logs(job_id.as_deref(), limit.unwrap_or(50))
}

#[tauri::command]
pub fn cron_tick(engine: tauri::State<'_, CronEngine>) -> Result<Vec<CronJob>, String> {
    engine.tick()
}

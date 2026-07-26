use std::sync::Mutex;

/// MOA routing strategy.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MoaStrategy {
    /// Round-robin across all models in the pool.
    RoundRobin,
    /// Query all models in parallel, return first complete response.
    Race,
    /// Query all models in parallel, aggregate results.
    Aggregate,
    /// Cascade: try primary, fallback to secondary on failure.
    Cascade,
    /// Route to cheapest model capable of the task.
    Cheapest,
}

/// A model endpoint in the MOA pool.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MoaModel {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub priority: u32,
    pub weight: f64,
    pub capabilities: Vec<String>,
    pub cost_per_1k: f64,
}

/// MOA routing plan — which models to call and how to combine results.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MoaPlan {
    pub models: Vec<MoaModel>,
    pub strategy: MoaStrategy,
    pub max_parallel: usize,
    pub timeout_ms: u64,
    pub aggregate_prompt: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct MoaResult {
    pub model_id: String,
    pub provider: String,
    pub model: String,
    pub success: bool,
    pub latency_ms: u64,
    pub output: String,
    pub error: Option<String>,
    pub tokens_used: u64,
}

pub struct MoaEngine {
    pool: Mutex<Vec<MoaModel>>,
    round_robin_idx: Mutex<usize>,
}

impl Default for MoaEngine {
    fn default() -> Self {
        Self {
            pool: Mutex::new(Vec::new()),
            round_robin_idx: Mutex::new(0),
        }
    }
}

impl MoaEngine {
    pub fn new() -> Self { Self::default() }

    pub fn register_model(&self, model: MoaModel) -> Result<(), String> {
        let mut pool = self.pool.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = pool.iter_mut().find(|m| m.id == model.id) {
            *existing = model;
        } else {
            pool.push(model);
        }
        Ok(())
    }

    pub fn unregister_model(&self, id: &str) -> Result<(), String> {
        let mut pool = self.pool.lock().map_err(|e| e.to_string())?;
        pool.retain(|m| m.id != id);
        Ok(())
    }

    pub fn list_models(&self) -> Result<Vec<MoaModel>, String> {
        self.pool.lock().map_err(|e| e.to_string()).map(|p| p.clone())
    }

    /// Build a routing plan for a given task.
    pub fn build_plan(&self, task: &str, strategy: MoaStrategy, capabilities: &[String]) -> Result<MoaPlan, String> {
        let pool = self.pool.lock().map_err(|e| e.to_string())?;
        if pool.is_empty() {
            return Err("MOA pool is empty — register at least one model".into());
        }

        let mut candidates: Vec<MoaModel> = if capabilities.is_empty() {
            pool.clone()
        } else {
            pool.iter()
                .filter(|m| capabilities.iter().all(|c| m.capabilities.contains(c)))
                .cloned()
                .collect()
        };

        if candidates.is_empty() {
            return Err(format!("No models in MOA pool support capabilities: {:?}", capabilities));
        }

        candidates.sort_by(|a, b| a.priority.cmp(&b.priority));

        let max_parallel = match strategy {
            MoaStrategy::Race | MoaStrategy::Aggregate => candidates.len().min(3).max(1),
            _ => 1,
        };

        let aggregate_prompt = match strategy {
            MoaStrategy::Aggregate => Some(format!(
                "Synthesize the best answer from the following model responses. Task: {task}",
            )),
            _ => None,
        };

        Ok(MoaPlan {
            models: candidates,
            strategy,
            max_parallel,
            timeout_ms: 60000,
            aggregate_prompt,
        })
    }

    /// Select next model via round-robin (for single-model calls).
    pub fn select_next(&self) -> Result<MoaModel, String> {
        let pool = self.pool.lock().map_err(|e| e.to_string())?;
        if pool.is_empty() {
            return Err("MOA pool is empty".into());
        }
        let mut idx = self.round_robin_idx.lock().map_err(|e| e.to_string())?;
        let model = pool[*idx % pool.len()].clone();
        *idx = idx.wrapping_add(1);
        Ok(model)
    }

    /// Aggregate multiple model results into a combined response.
    /// Returns a synthetic summary with contributions from each model.
    pub fn aggregate_results(&self, results: &[MoaResult]) -> String {
        let mut lines = Vec::new();
        lines.push("<moa_aggregated>".to_string());
        for r in results {
            let status = if r.success { "OK" } else { "FAIL" };
            lines.push(format!(
                "[{status}] {} ({}): {}ms, {} tokens",
                r.model_id, r.provider, r.latency_ms, r.tokens_used
            ));
            if r.success {
                // Truncate each contribution
                let preview: String = r.output.chars().take(200).collect();
                lines.push(format!("  └─ {}", preview.replace('\n', " ")));
            } else {
                lines.push(format!("  └─ ERROR: {}", r.error.as_deref().unwrap_or("unknown")));
            }
        }
        lines.push("</moa_aggregated>".to_string());
        lines.join("\n")
    }

    /// Score a model's suitability for a task based on capabilities and cost.
    pub fn score_model(&self, model: &MoaModel, required_caps: &[String]) -> f64 {
        let cap_score = if required_caps.is_empty() {
            1.0
        } else {
            let matches = required_caps.iter().filter(|c| model.capabilities.contains(*c)).count();
            matches as f64 / required_caps.len() as f64
        };
        let cost_score = 1.0 / (model.cost_per_1k + 0.01);
        let weight = model.weight;
        cap_score * 0.5 + (cost_score / 10.0).min(0.5) + weight * 0.2
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn moa_register(engine: tauri::State<'_, MoaEngine>, model: MoaModel) -> Result<(), String> {
    engine.register_model(model)
}

#[tauri::command]
pub fn moa_unregister(engine: tauri::State<'_, MoaEngine>, id: String) -> Result<(), String> {
    engine.unregister_model(&id)
}

#[tauri::command]
pub fn moa_list(engine: tauri::State<'_, MoaEngine>) -> Result<Vec<MoaModel>, String> {
    engine.list_models()
}

#[tauri::command]
pub fn moa_select(engine: tauri::State<'_, MoaEngine>, task: String, strategy: MoaStrategy, capabilities: Vec<String>) -> Result<MoaPlan, String> {
    engine.build_plan(&task, strategy, &capabilities)
}

use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct UsageRecord {
    pub id: String,
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_tokens: u64,
    pub cost_usd: f64,
    pub session_id: String,
    pub tool_calls: u32,
    pub duration_ms: u64,
    pub success: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct UsageSummary {
    pub total_queries: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_tokens: u64,
    pub total_cost_usd: f64,
    pub total_duration_ms: u64,
    pub by_provider: Vec<ProviderBreakdown>,
    pub daily_costs: Vec<DailyCost>,
    pub estimated_monthly_cost: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderBreakdown {
    pub provider: String,
    pub queries: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct DailyCost {
    pub date: String,
    pub cost_usd: f64,
    pub queries: u64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BudgetConfig {
    pub monthly_budget_usd: f64,
    pub per_query_limit_usd: f64,
    pub alert_threshold: f64,
    pub enabled: bool,
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self {
            monthly_budget_usd: 50.0,
            per_query_limit_usd: 0.50,
            alert_threshold: 0.8,
            enabled: false,
        }
    }
}

/// Model pricing map: (provider, model_id) -> (input_per_1k, output_per_1k, cache_read_per_1k)
const MODEL_PRICING: &[(&str, &str, f64, f64, f64)] = &[
    ("openai", "gpt-5.6", 5.0, 30.0, 0.5),
    ("openai", "gpt-5.6-terra", 2.5, 15.0, 0.25),
    ("openai", "gpt-5.6-luna", 1.0, 6.0, 0.1),
    ("openai", "gpt-5.5", 5.0, 30.0, 0.5),
    ("openai", "gpt-5.5-pro", 30.0, 180.0, 0.0),
    ("openai", "gpt-5.4-mini", 0.75, 4.5, 0.075),
    ("openai", "gpt-5.4-nano", 0.2, 1.25, 0.02),
    ("openai", "gpt-4.1-mini", 0.4, 1.6, 0.1),
    ("anthropic", "claude-sonnet-5", 3.0, 15.0, 0.3),
    ("anthropic", "claude-haiku-4-5", 1.0, 5.0, 0.1),
    ("anthropic", "claude-opus-4-8", 5.0, 25.0, 0.5),
    ("google", "gemini-3.5-flash", 0.3, 2.5, 0.075),
    ("google", "gemini-2.5-pro", 1.25, 10.0, 0.31),
    ("xai", "grok-4.5", 2.0, 6.0, 0.5),
    ("xai", "grok-4.3", 1.25, 2.5, 0.0),
    ("deepseek", "deepseek-v4-pro", 0.28, 1.1, 0.028),
    ("deepseek", "deepseek-v4-flash", 0.07, 0.27, 0.007),
    ("mistral", "mistral-large-latest", 2.0, 6.0, 0.0),
    ("openrouter", "openrouter-custom", 1.0, 3.0, 0.0),
];

pub struct BillingEngine {
    records: Mutex<Vec<UsageRecord>>,
    budget: Mutex<BudgetConfig>,
    next_id: Mutex<u64>,
}

impl Default for BillingEngine {
    fn default() -> Self {
        Self {
            records: Mutex::new(Vec::new()),
            budget: Mutex::new(BudgetConfig::default()),
            next_id: Mutex::new(1),
        }
    }
}

impl BillingEngine {
    pub fn new() -> Self { Self::default() }

    fn now_iso() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let secs = d.as_secs();
        format!("{}", secs)
    }

    #[allow(dead_code)]
    fn today() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let secs = d.as_secs();
        let days = secs / 86400;
        format!("day-{}", days)
    }

    /// Calculate cost for a given model and token usage.
    pub fn calculate_cost(provider: &str, model: &str, input_tokens: u64, output_tokens: u64, cached_tokens: u64) -> f64 {
        for (p, m, input_rate, output_rate, cache_rate) in MODEL_PRICING {
            if *p == provider && *m == model {
                let input_cost = (input_tokens as f64 / 1000.0) * input_rate;
                let output_cost = (output_tokens as f64 / 1000.0) * output_rate;
                let cache_cost = (cached_tokens as f64 / 1000.0) * cache_rate;
                return input_cost + output_cost + cache_cost;
            }
        }
        // Fallback: estimate at $2/M input, $8/M output
        (input_tokens as f64 / 1000.0 * 2.0) + (output_tokens as f64 / 1000.0 * 8.0)
    }

    /// Record a usage event.
    pub fn record_usage(&self, provider: &str, model: &str, input_tokens: u64, output_tokens: u64, cached_tokens: u64, session_id: &str, tool_calls: u32, duration_ms: u64, success: bool) -> Result<UsageRecord, String> {
        let cost = Self::calculate_cost(provider, model, input_tokens, output_tokens, cached_tokens);
        let mut next = self.next_id.lock().map_err(|e| e.to_string())?;
        let id = format!("usage-{}", *next);
        *next += 1;
        drop(next);

        let record = UsageRecord {
            id,
            timestamp: Self::now_iso(),
            provider: provider.into(),
            model: model.into(),
            input_tokens,
            output_tokens,
            cached_tokens,
            cost_usd: (cost * 1000.0).round() / 1000.0,
            session_id: session_id.into(),
            tool_calls,
            duration_ms,
            success,
        };

        let mut records = self.records.lock().map_err(|e| e.to_string())?;
        records.push(record.clone());
        if records.len() > 10000 { records.remove(0); }

        // Check budget alert
        if let Ok(budget) = self.budget.lock() {
            if budget.enabled {
                let summary = Self::aggregate_internal(&records, &budget);
                if summary.total_cost_usd >= budget.monthly_budget_usd * budget.alert_threshold {
                    log::warn!(
                        "Billing alert: ${:.2} spent (threshold: ${:.2})",
                        summary.total_cost_usd,
                        budget.monthly_budget_usd * budget.alert_threshold,
                    );
                }
            }
        }

        Ok(record)
    }

    /// Get usage summary.
    pub fn get_summary(&self) -> Result<UsageSummary, String> {
        let records = self.records.lock().map_err(|e| e.to_string())?;
        let budget = self.budget.lock().map_err(|e| e.to_string())?;
        Ok(Self::aggregate_internal(&records, &budget))
    }

    fn aggregate_internal(records: &[UsageRecord], _budget: &BudgetConfig) -> UsageSummary {
        let total_queries = records.len() as u64;
        let total_input_tokens: u64 = records.iter().map(|r| r.input_tokens).sum();
        let total_output_tokens: u64 = records.iter().map(|r| r.output_tokens).sum();
        let total_cached_tokens: u64 = records.iter().map(|r| r.cached_tokens).sum();
        let total_cost_usd: f64 = records.iter().map(|r| r.cost_usd).sum();
        let total_duration_ms: u64 = records.iter().map(|r| r.duration_ms).sum();

        // By provider
        let mut prov_map: HashMap<String, (u64, u64, u64, f64)> = HashMap::new();
        for r in records {
            let entry = prov_map.entry(r.provider.clone()).or_default();
            entry.0 += 1;
            entry.1 += r.input_tokens;
            entry.2 += r.output_tokens;
            entry.3 += r.cost_usd;
        }
        let by_provider: Vec<ProviderBreakdown> = prov_map.into_iter()
            .map(|(provider, (queries, input, output, cost))| ProviderBreakdown {
                provider,
                queries,
                input_tokens: input,
                output_tokens: output,
                cost_usd: (cost * 1000.0).round() / 1000.0,
            })
            .collect();

        // Daily costs (last 30 days)
        let mut day_map: HashMap<String, (f64, u64)> = HashMap::new();
        for r in records.iter().rev().take(1000) {
            let day = &r.timestamp[..10.min(r.timestamp.len())];
            let entry = day_map.entry(day.to_string()).or_default();
            entry.0 += r.cost_usd;
            entry.1 += 1;
        }
        let mut daily_costs: Vec<DailyCost> = day_map.into_iter()
            .map(|(date, (cost, queries))| DailyCost { date, cost_usd: (cost * 1000.0).round() / 1000.0, queries })
            .collect();
        daily_costs.sort_by(|a, b| a.date.cmp(&b.date));

        // Monthly estimate
        let days_active = daily_costs.len().max(1) as f64;
        let estimated_monthly = if days_active > 0.0 {
            (total_cost_usd / days_active * 30.0 * 1000.0).round() / 1000.0
        } else {
            0.0
        };

        UsageSummary {
            total_queries,
            total_input_tokens,
            total_output_tokens,
            total_cached_tokens,
            total_cost_usd: (total_cost_usd * 1000.0).round() / 1000.0,
            total_duration_ms,
            by_provider,
            daily_costs,
            estimated_monthly_cost: estimated_monthly,
        }
    }

    pub fn get_budget(&self) -> Result<BudgetConfig, String> {
        self.budget.lock().map_err(|e| e.to_string()).map(|b| b.clone())
    }

    pub fn set_budget(&self, config: BudgetConfig) -> Result<(), String> {
        *self.budget.lock().map_err(|e| e.to_string())? = config;
        Ok(())
    }

    pub fn get_recent_usage(&self, limit: usize) -> Result<Vec<UsageRecord>, String> {
        let records = self.records.lock().map_err(|e| e.to_string())?;
        Ok(records.iter().rev().take(limit).cloned().collect())
    }

    pub fn get_usage_by_session(&self, session_id: &str) -> Result<Vec<UsageRecord>, String> {
        let records = self.records.lock().map_err(|e| e.to_string())?;
        Ok(records.iter().filter(|r| r.session_id == session_id).cloned().collect())
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn billing_record(
    engine: tauri::State<'_, BillingEngine>,
    provider: String, model: String,
    input_tokens: u64, output_tokens: u64, cached_tokens: u64,
    session_id: String, tool_calls: u32, duration_ms: u64, success: bool,
) -> Result<UsageRecord, String> {
    engine.record_usage(&provider, &model, input_tokens, output_tokens, cached_tokens, &session_id, tool_calls, duration_ms, success)
}

#[tauri::command]
pub fn billing_summary(engine: tauri::State<'_, BillingEngine>) -> Result<UsageSummary, String> {
    engine.get_summary()
}

#[tauri::command]
pub fn billing_get_budget(engine: tauri::State<'_, BillingEngine>) -> Result<BudgetConfig, String> {
    engine.get_budget()
}

#[tauri::command]
pub fn billing_set_budget(engine: tauri::State<'_, BillingEngine>, config: BudgetConfig) -> Result<(), String> {
    engine.set_budget(config)
}

#[tauri::command]
pub fn billing_recent(engine: tauri::State<'_, BillingEngine>, limit: Option<usize>) -> Result<Vec<UsageRecord>, String> {
    engine.get_recent_usage(limit.unwrap_or(50))
}

#[tauri::command]
pub fn billing_calculate_cost(
    _engine: tauri::State<'_, BillingEngine>,
    provider: String, model: String,
    input_tokens: u64, output_tokens: u64, cached_tokens: u64,
) -> Result<f64, String> {
    Ok((BillingEngine::calculate_cost(&provider, &model, input_tokens, output_tokens, cached_tokens) * 1000.0).round() / 1000.0)
}

//! Agent lifecycle state machine (R28 #3). Mirrors  `SubagentState` +
//! `SubagentHandle`: an explicit state enum + instance record is the
//! observability basis for the whole platform. The manager is pure
//! (in-memory HashMap + history Vec), unit-tested; persistence is a thin
//! JSON helper on top.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::agent_def::AgentId;

/// Execution state of one agent instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AgentState {
    Created,
    Running,
    Idle,
    Paused,
    Stopped,
    Failed(String),
}

impl AgentState {
    pub fn is_terminal(&self) -> bool {
        matches!(self, AgentState::Idle | AgentState::Stopped | AgentState::Failed(_))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub cached_input: u64,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cached_input
    }
}

/// A single step record inside a run (tool call / LLM turn).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRecord {
    pub step: u32,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub tool_output: Option<String>,
    pub duration_ms: u64,
    pub token_delta: TokenUsage,
}

/// Runtime state of one agent instance ( `SubagentHandle` analog).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstance {
    pub id: String,
    pub def_id: AgentId,
    pub state: AgentState,
    pub session_id: String,
    pub parent_id: Option<String>,
    pub depth: u32,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub step_count: u32,
    pub token_usage: TokenUsage,
    pub cost_usd: f64,
    pub error: Option<String>,
}

/// A completed run, retained for history / observability.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub instance_id: String,
    pub def_id: AgentId,
    pub input: String,
    pub output: Option<String>,
    pub state: AgentState,
    pub steps: Vec<StepRecord>,
    pub duration_ms: u64,
    pub token_usage: TokenUsage,
    pub cost_usd: f64,
}

#[derive(Debug, Default)]
pub struct AgentLifecycleManager {
    instances: RwLock<HashMap<String, AgentInstance>>,
    history: RwLock<Vec<AgentRunRecord>>,
    next_id: RwLock<u64>,
}

/// Default cost cap (USD) when an agent def sets none.
pub const DEFAULT_BUDGET_CAP_USD: f64 = 2.0;

/// Check whether an accumulated cost is within an optional cap.
pub fn within_budget(cost_usd: f64, budget_cap: Option<f64>) -> bool {
    budget_cap.map(|cap| cost_usd < cap).unwrap_or(true)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl AgentLifecycleManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create an agent instance in `Created` state.
    pub fn create(&self, def_id: AgentId, session_id: String, parent_id: Option<String>, depth: u32) -> String {
        let id = {
            let mut n = self.next_id.write().unwrap_or_else(|e| e.into_inner());
            *n += 1;
            format!("inst-{}-{}", now_ms(), n)
        };
        let instance = AgentInstance {
            id: id.clone(),
            def_id,
            state: AgentState::Created,
            session_id,
            parent_id,
            depth,
            created_at: now_ms(),
            started_at: None,
            finished_at: None,
            step_count: 0,
            token_usage: TokenUsage::default(),
            cost_usd: 0.0,
            error: None,
        };
        self.instances
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.clone(), instance);
        id
    }

    pub fn get(&self, id: &str) -> Option<AgentInstance> {
        self.instances
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }

    pub fn transition(&self, id: &str, next: AgentState) -> Result<(), String> {
        let mut map = self.instances.write().unwrap_or_else(|e| e.into_inner());
        let inst = map
            .get_mut(id)
            .ok_or_else(|| format!("no agent instance {id}"))?;
        if inst.state.is_terminal() {
            return Err(format!("cannot transition terminal instance {id}"));
        }
        if matches!(next, AgentState::Running) && inst.started_at.is_none() {
            inst.started_at = Some(now_ms());
        }
        if next.is_terminal() {
            inst.finished_at = Some(now_ms());
        }
        if let AgentState::Failed(e) = &next {
            inst.error = Some(e.clone());
        }
        inst.state = next;
        Ok(())
    }

    /// Accumulate token/cost deltas on the instance after a step. Step
    /// details (tool name/io/duration) are collected by the caller and passed
    /// to `finalize` as `StepRecord`s.
    pub fn record_step(
        &self,
        id: &str,
        step: u32,
        token_delta: TokenUsage,
        cost_delta: f64,
    ) -> Result<(), String> {
        let mut map = self.instances.write().unwrap_or_else(|e| e.into_inner());
        let inst = map
            .get_mut(id)
            .ok_or_else(|| format!("no agent instance {id}"))?;
        inst.step_count = step.max(inst.step_count);
        inst.token_usage.input = inst.token_usage.input.saturating_add(token_delta.input);
        inst.token_usage.output = inst.token_usage.output.saturating_add(token_delta.output);
        inst.token_usage.cached_input = inst
            .token_usage
            .cached_input
            .saturating_add(token_delta.cached_input);
        inst.cost_usd += cost_delta;
        Ok(())
    }

    /// Finalize a run into history. Returns the run record.
    pub fn finalize(&self, id: &str, input: String, output: Option<String>, steps: Vec<StepRecord>) -> Result<AgentRunRecord, String> {
        let inst = self
            .instances
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
            .ok_or_else(|| format!("no agent instance {id}"))?;
        let duration_ms = inst
            .started_at
            .map(|s| inst.finished_at.unwrap_or(now_ms()).saturating_sub(s))
            .unwrap_or(0);
        let record = AgentRunRecord {
            instance_id: inst.id,
            def_id: inst.def_id,
            input,
            output,
            state: inst.state.clone(),
            steps,
            duration_ms,
            token_usage: inst.token_usage,
            cost_usd: inst.cost_usd,
        };
        self.history
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .push(record.clone());
        Ok(record)
    }

    pub fn history(&self) -> Vec<AgentRunRecord> {
        self.history.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// History for a single agent definition (recent first).
    pub fn history_for(&self, def_id: &AgentId) -> Vec<AgentRunRecord> {
        let mut out: Vec<AgentRunRecord> = self
            .history
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|r| &r.def_id == def_id)
            .cloned()
            .collect();
        out.reverse();
        out
    }
}

// ── Checkpoint / resume (R28 #6): persist history + live instances to disk ──

/// Serialize the manager's full state (history + live instances) to JSON.
/// Pure helper — callers own the file I/O so it is testable.
pub fn serialize_state(mgr: &AgentLifecycleManager) -> serde_json::Value {
    use serde_json::json;
    json!({
        "history": mgr.history(),
        "instances": mgr.instances.read().unwrap_or_else(|e| e.into_inner()).values().cloned().collect::<Vec<_>>(),
    })
}

/// Rehydrate a manager from previously serialized state (R28 #6 resume).
/// Returns (history, instances); the caller feeds them via `restore_state`.
pub fn deserialize_state(raw: &str) -> (Vec<AgentRunRecord>, Vec<AgentInstance>) {
    let v: serde_json::Value = serde_json::from_str(raw).unwrap_or(serde_json::Value::Null);
    let history: Vec<AgentRunRecord> =
        serde_json::from_value(v.get("history").cloned().unwrap_or_default()).unwrap_or_default();
    let instances: Vec<AgentInstance> =
        serde_json::from_value(v.get("instances").cloned().unwrap_or_default()).unwrap_or_default();
    (history, instances)
}

impl AgentLifecycleManager {
    /// Restore serialized history + instances (for resume after restart).
    pub fn restore_state(&self, history: Vec<AgentRunRecord>, instances: Vec<AgentInstance>) {
        *self.history.write().unwrap_or_else(|e| e.into_inner()) = history;
        for inst in instances {
            self.instances
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .insert(inst.id.clone(), inst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_then_run_then_finalize() {
        let mgr = AgentLifecycleManager::new();
        let id = mgr.create("reviewer".into(), "sess-1".into(), None, 0);
        assert_eq!(mgr.get(&id).unwrap().state, AgentState::Created);
        mgr.transition(&id, AgentState::Running).unwrap();
        mgr.record_step(
            &id,
            1,
            TokenUsage { input: 100, output: 20, cached_input: 0 },
            0.001,
        )
        .unwrap();
        mgr.transition(&id, AgentState::Idle).unwrap();
        let rec = mgr.finalize(&id, "task".into(), Some("done".into()), vec![]).unwrap();
        assert_eq!(rec.state, AgentState::Idle);
        assert_eq!(rec.token_usage.total(), 120);
        assert!(rec.cost_usd > 0.0);
        assert_eq!(mgr.history().len(), 1);
    }

    #[test]
    fn transition_from_terminal_is_rejected() {
        let mgr = AgentLifecycleManager::new();
        let id = mgr.create("a".into(), "s".into(), None, 0);
        mgr.transition(&id, AgentState::Stopped).unwrap();
        assert!(mgr.transition(&id, AgentState::Running).is_err());
    }

    #[test]
    fn failed_carries_error() {
        let mgr = AgentLifecycleManager::new();
        let id = mgr.create("a".into(), "s".into(), None, 0);
        mgr.transition(&id, AgentState::Running).unwrap();
        mgr.transition(&id, AgentState::Failed("boom".into())).unwrap();
        let inst = mgr.get(&id).unwrap();
        assert_eq!(inst.error.as_deref(), Some("boom"));
        assert!(inst.state.is_terminal());
    }

    #[test]
    fn history_for_filters_and_orders_recent_first() {
        let mgr = AgentLifecycleManager::new();
        for i in 0..3 {
            let id = mgr.create("d".into(), "s".into(), None, 0);
            mgr.transition(&id, AgentState::Idle).unwrap();
            mgr.finalize(&id, format!("t{i}"), None, vec![]).unwrap();
        }
        let other = mgr.create("e".into(), "s".into(), None, 0);
        mgr.transition(&other, AgentState::Idle).unwrap();
        mgr.finalize(&other, "o".into(), None, vec![]).unwrap();
        let d = mgr.history_for(&"d".to_string());
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].input, "t2");
    }

    #[test]
    fn checkpoint_roundtrips_history_and_instances() {
        let mgr = AgentLifecycleManager::new();
        let id = mgr.create("reviewer".into(), "sess".into(), None, 0);
        mgr.transition(&id, AgentState::Running).unwrap();
        mgr.record_step(&id, 1, TokenUsage { input: 10, output: 5, cached_input: 0 }, 0.0001)
            .unwrap();
        mgr.transition(&id, AgentState::Idle).unwrap();
        mgr.finalize(&id, "task".into(), Some("ok".into()), vec![]).unwrap();

        let json = serialize_state(&mgr);
        let raw = serde_json::to_string(&json).unwrap();
        let (history, instances) = deserialize_state(&raw);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].def_id, "reviewer");
        assert_eq!(history[0].token_usage.total(), 15);

        let mgr2 = AgentLifecycleManager::new();
        mgr2.restore_state(history, instances);
        assert_eq!(mgr2.history().len(), 1);
        assert_eq!(mgr2.get(&id).unwrap().state, AgentState::Idle);
    }

    #[test]
    fn budget_cap_gate() {
        assert!(within_budget(0.5, Some(2.0)));
        assert!(!within_budget(2.0, Some(2.0)));
        assert!(!within_budget(3.0, Some(2.0)));
        assert!(within_budget(100.0, None)); // no cap = always allowed
    }
}

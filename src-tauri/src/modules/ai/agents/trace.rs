//! Agent execution trace (R28 #4). Mirrors Terminator's ProgressCallback +
//! Flock's token accounting: a span tree records every LLM call / tool call /
//! subagent spawn / approval wait with timing, tokens, and cost. The recorder
//! is pure and unit-tested; a serialized `AgentTrace` is the input to the
//! timeline UI and the debug-replay feature.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::lifecycle::TokenUsage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpanKind {
    LlmCall,
    ToolCall,
    Reasoning,
    SubagentSpawn,
    WaitApproval,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SpanStatus {
    Running,
    Completed,
    Failed(String),
}

impl SpanStatus {
    pub fn is_terminal(&self) -> bool {
        !matches!(self, SpanStatus::Running)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSpan {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: SpanKind,
    pub name: String,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub status: SpanStatus,
    #[serde(default)]
    pub token_delta: TokenUsage,
    #[serde(default)]
    pub cost_delta: f64,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl TraceSpan {
    pub fn duration_ms(&self) -> u64 {
        self.end_ms
            .map(|e| e.saturating_sub(self.start_ms))
            .unwrap_or(0)
    }
}

/// The full execution trace of one agent run (root = the agent itself).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTrace {
    pub root_id: String,
    pub spans: Vec<TraceSpan>,
    pub total_tokens: TokenUsage,
    pub total_cost_usd: f64,
    pub total_duration_ms: u64,
}

impl AgentTrace {
    /// Build the parent→children tree (children sorted by start time).
    pub fn children_of<'a>(&'a self, parent_id: &str) -> Vec<&'a TraceSpan> {
        let mut out: Vec<&'a TraceSpan> = self
            .spans
            .iter()
            .filter(|s| s.parent_id.as_deref() == Some(parent_id))
            .collect();
        out.sort_by_key(|s| s.start_ms);
        out
    }

    pub fn root(&self) -> Option<&TraceSpan> {
        self.spans.iter().find(|s| s.id == self.root_id)
    }
}

/// Incremental trace recorder. Thread-safe; callers open/close spans around
/// each observable unit of work and call `finish` to snapshot the trace.
#[derive(Debug, Default)]
pub struct TraceRecorder {
    spans: std::sync::RwLock<Vec<TraceSpan>>,
    root_id: std::sync::RwLock<Option<String>>,
    next: std::sync::RwLock<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl TraceRecorder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a span under `parent_id` (None = root). Returns the span id.
    pub fn open(&self, parent_id: Option<String>, kind: SpanKind, name: impl Into<String>) -> String {
        let id = {
            let mut n = self.next.write().unwrap_or_else(|e| e.into_inner());
            *n += 1;
            format!("span-{}-{}", now_ms(), n)
        };
        let span = TraceSpan {
            id: id.clone(),
            parent_id,
            kind,
            name: name.into(),
            start_ms: now_ms(),
            end_ms: None,
            status: SpanStatus::Running,
            token_delta: TokenUsage::default(),
            cost_delta: 0.0,
            metadata: HashMap::new(),
        };
        {
            let mut root = self.root_id.write().unwrap_or_else(|e| e.into_inner());
            if root.is_none() {
                *root = Some(id.clone());
            }
        }
        self.spans
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .push(span);
        id
    }

    pub fn add_metadata(&self, id: &str, key: impl Into<String>, value: serde_json::Value) {
        let mut spans = self.spans.write().unwrap_or_else(|e| e.into_inner());
        if let Some(s) = spans.iter_mut().find(|s| s.id == id) {
            s.metadata.insert(key.into(), value);
        }
    }

    /// Close a span as completed (optionally recording token/cost deltas).
    pub fn close(&self, id: &str, token_delta: TokenUsage, cost_delta: f64) -> Result<(), String> {
        self.finish_span(id, token_delta, cost_delta, SpanStatus::Completed)
    }

    pub fn fail(&self, id: &str, error: impl Into<String>) -> Result<(), String> {
        self.finish_span(id, TokenUsage::default(), 0.0, SpanStatus::Failed(error.into()))
    }

    fn finish_span(
        &self,
        id: &str,
        token_delta: TokenUsage,
        cost_delta: f64,
        status: SpanStatus,
    ) -> Result<(), String> {
        let mut spans = self.spans.write().unwrap_or_else(|e| e.into_inner());
        let span = spans
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("no trace span {id}"))?;
        if span.status.is_terminal() {
            return Err(format!("span {id} already closed"));
        }
        span.end_ms = Some(now_ms());
        span.status = status;
        span.token_delta = token_delta;
        span.cost_delta = cost_delta;
        Ok(())
    }

    /// Snapshot the current trace (aggregating totals), and reset the recorder.
    pub fn finish(&self) -> AgentTrace {
        let root_id = self
            .root_id
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or_default();
        let spans = self.spans.read().unwrap_or_else(|e| e.into_inner()).clone();
        let mut total = TokenUsage::default();
        let mut cost = 0.0;
        let mut duration = 0u64;
        for s in &spans {
            total.input = total.input.saturating_add(s.token_delta.input);
            total.output = total.output.saturating_add(s.token_delta.output);
            total.cached_input = total
                .cached_input
                .saturating_add(s.token_delta.cached_input);
            cost += s.cost_delta;
            duration = duration.max(s.duration_ms());
        }
        let trace = AgentTrace {
            root_id,
            spans,
            total_tokens: total,
            total_cost_usd: cost,
            total_duration_ms: duration,
        };
        self.spans.write().unwrap_or_else(|e| e.into_inner()).clear();
        *self.root_id.write().unwrap_or_else(|e| e.into_inner()) = None;
        trace
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_nested_span_tree() {
        let rec = TraceRecorder::new();
        let root = rec.open(None, SpanKind::LlmCall, "agent turn");
        let tool = rec.open(Some(root.clone()), SpanKind::ToolCall, "read_file");
        rec.close(&tool, TokenUsage { input: 50, output: 0, cached_input: 0 }, 0.001)
            .unwrap();
        rec.close(&root, TokenUsage { input: 100, output: 30, cached_input: 0 }, 0.002)
            .unwrap();
        let trace = rec.finish();
        assert_eq!(trace.root_id, root);
        assert_eq!(trace.spans.len(), 2);
        assert_eq!(trace.children_of(&root).len(), 1);
        assert_eq!(trace.children_of(&root)[0].id, tool);
        assert_eq!(trace.total_tokens.total(), 180);
        assert_eq!(trace.total_cost_usd, 0.003);
        assert_eq!(
            trace.total_duration_ms,
            trace.spans.iter().map(|s| s.duration_ms()).max().unwrap_or(0)
        );
    }

    #[test]
    fn fail_sets_status_and_error() {
        let rec = TraceRecorder::new();
        let root = rec.open(None, SpanKind::SubagentSpawn, "reviewer");
        rec.fail(&root, "boom").unwrap();
        let trace = rec.finish();
        assert!(matches!(trace.root().unwrap().status, SpanStatus::Failed(ref e) if e == "boom"));
    }

    #[test]
    fn closing_twice_is_rejected() {
        let rec = TraceRecorder::new();
        let id = rec.open(None, SpanKind::ToolCall, "grep");
        rec.close(&id, TokenUsage::default(), 0.0).unwrap();
        assert!(rec.close(&id, TokenUsage::default(), 0.0).is_err());
    }

    #[test]
    fn metadata_is_captured() {
        let rec = TraceRecorder::new();
        let id = rec.open(None, SpanKind::LlmCall, "llm");
        rec.add_metadata(&id, "model", json!("deepseek-v4-flash"));
        let trace = rec.finish();
        assert_eq!(
            trace.root().unwrap().metadata.get("model").and_then(|v| v.as_str()),
            Some("deepseek-v4-flash")
        );
    }
}

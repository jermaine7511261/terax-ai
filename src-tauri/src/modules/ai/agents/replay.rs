//! Debug replay (R28 #14,  journal / Terminator WorkflowRecorder): turn a
//! recorded `AgentTrace` into an ordered list of replay frames so execution
//! can be stepped through frame-by-frame. The live loop records spans via
//! `TraceRecorder`; this module is the pure replay core.

use serde::{Deserialize, Serialize};

use super::trace::{AgentTrace, SpanKind, SpanStatus};

/// One replayable step in the trace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayFrame {
    pub depth: u32,
    pub kind: SpanKind,
    pub name: String,
    pub status: String,
    pub duration_ms: u64,
    pub token_delta_input: u64,
    pub token_delta_output: u64,
    pub error: Option<String>,
}

/// Linearize a span tree into frames ordered by start time (pre-order). Each
/// frame carries the depth so a UI can indent the timeline like a call stack.
pub fn build_replay_frames(trace: &AgentTrace) -> Vec<ReplayFrame> {
    let mut out = Vec::new();
    let mut stack: Vec<(&super::trace::TraceSpan, u32)> = Vec::new();

    // Build children maps once.
    let mut by_parent: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (i, s) in trace.spans.iter().enumerate() {
        if let Some(p) = &s.parent_id {
            by_parent.entry(p.clone()).or_default().push(i);
        }
    }
    // Sort each child list by start time.
    for list in by_parent.values_mut() {
        list.sort_by_key(|&i| trace.spans[i].start_ms);
    }

    // Root children (parent == root_id) start the traversal.
    let mut roots: Vec<usize> = (0..trace.spans.len())
        .filter(|&i| trace.spans[i].parent_id.is_none())
        .collect();
    roots.sort_by_key(|&i| trace.spans[i].start_ms);

    // Pre-order DFS.
    for &root in &roots {
        stack.push((&trace.spans[root], 0));
        while let Some((span, depth)) = stack.pop() {
            let status = match &span.status {
                SpanStatus::Running => "running".to_string(),
                SpanStatus::Completed => "completed".to_string(),
                SpanStatus::Failed(e) => format!("failed: {e}"),
            };
            let error = match &span.status {
                SpanStatus::Failed(e) => Some(e.clone()),
                _ => None,
            };
            out.push(ReplayFrame {
                depth,
                kind: span.kind,
                name: span.name.clone(),
                status,
                duration_ms: span.duration_ms(),
                token_delta_input: span.token_delta.input,
                token_delta_output: span.token_delta.output,
                error,
            });
            if let Some(children) = by_parent.get(&span.id) {
                // Push in reverse so the earliest child pops first.
                for &c in children.iter().rev() {
                    stack.push((&trace.spans[c], depth + 1));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::ai::agents::lifecycle::TokenUsage;
    use crate::modules::ai::agents::trace::TraceRecorder;

    #[test]
    fn replay_frames_linearize_nested_spans_preorder() {
        let rec = TraceRecorder::new();
        let root = rec.open(None, SpanKind::LlmCall, "turn 1");
        let tool = rec.open(Some(root.clone()), SpanKind::ToolCall, "read_file");
        rec.close(&tool, TokenUsage { input: 10, output: 0, cached_input: 0 }, 0.0)
            .unwrap();
        rec.close(&root, TokenUsage { input: 50, output: 20, cached_input: 0 }, 0.0)
            .unwrap();
        let trace = rec.finish();
        let frames = build_replay_frames(&trace);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].name, "turn 1");
        assert_eq!(frames[0].depth, 0);
        assert_eq!(frames[1].name, "read_file");
        assert_eq!(frames[1].depth, 1);
        assert_eq!(frames[1].token_delta_input, 10);
    }

    #[test]
    fn replay_frames_carry_failure_status() {
        let rec = TraceRecorder::new();
        let root = rec.open(None, SpanKind::SubagentSpawn, "reviewer");
        rec.fail(&root, "boom").unwrap();
        let trace = rec.finish();
        let frames = build_replay_frames(&trace);
        assert_eq!(frames[0].status, "failed: boom");
        assert_eq!(frames[0].error.as_deref(), Some("boom"));
    }
}

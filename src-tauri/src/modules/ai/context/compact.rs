//! Context compaction pure-function core (P1), mirroring the frontend
//! `lib/compact.ts` contract so existing `compact.test.ts` behaviors are
//! reproduced in Rust. Messages are modeled as `serde_json::Value` (the wire
//! shape the harness already handles), keeping this layer free of I/O.
//!
//! Head/tail protection ( context_compressor): never elide the first
//! `protect_first` / last `protect_last` messages.

use serde_json::{json, Value};

pub const PROTECT_FIRST_N: usize = 3;
pub const PROTECT_LAST_N: usize = 6;
const KEEP_TAIL: usize = 24;
const ELISION_TEXT: &str = "[elided to save context — see prior tool call in history]";

fn text_len(s: &str) -> usize {
    s.len()
}

/// Approximate byte count of a message list: string content is counted raw,
/// parts are counted by type (text / tool-result output / tool-call input /
/// fallback 64), matching `approxBytes` in the frontend.
fn approx_bytes(messages: &[Value]) -> usize {
    let mut n = 0;
    for m in messages {
        match m.get("content") {
            Some(Value::String(s)) => n += text_len(s),
            Some(Value::Array(parts)) => {
                for part in parts {
                    match part.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            if let Some(t) = part.get("text").and_then(Value::as_str) {
                                n += text_len(t);
                            } else {
                                n += 64;
                            }
                        }
                        Some("tool-result") => {
                            n += json_string_len(part.get("output"));
                        }
                        Some("tool-call") => {
                            n += json_string_len(part.get("input"));
                        }
                        _ => n += 64,
                    }
                }
            }
            _ => n += 64,
        }
    }
    n
}

fn json_string_len(v: Option<&Value>) -> usize {
    match v {
        Some(value) => serde_json::to_vec(value).unwrap_or_default().len(),
        None => 0,
    }
}

/// Approximate tokens for the given messages (`approx_bytes / 4`).
pub fn approx_tokens(messages: &[Value]) -> u64 {
    (approx_bytes(messages) / 4) as u64
}

/// 1/4 shouldCompress: same 0.7x threshold as the frontend.
pub fn should_compress(approx_tokens: u64, context_limit: u64) -> bool {
    approx_tokens >= context_limit * 7 / 10
}

fn elide_tool_result(part: &Value) -> (bool, Value) {
    if part.get("type").and_then(Value::as_str) != Some("tool-result") {
        return (false, part.clone());
    }
    if let Some(output) = part.get("output") {
        if output.get("__elided").and_then(Value::as_bool) == Some(true) {
            return (false, part.clone());
        }
    }
    let mut out = part.clone();
    if let Some(o) = out.as_object_mut() {
        o.insert(
            "output".to_string(),
            json!({ "type": "text", "value": ELISION_TEXT, "__elided": true }),
        );
    }
    (true, out)
}

fn path_of_input(input: &Value) -> Option<String> {
    let p = input.get("path").and_then(Value::as_str)?;
    if p.is_empty() {
        None
    } else {
        Some(p.to_string())
    }
}

fn is_mutation_tool(name: &str) -> bool {
    matches!(name, "edit" | "multi_edit" | "write_file" | "create_directory")
}

fn collect_mutation_paths(messages: &[Value]) -> std::collections::HashSet<String> {
    let mut paths = std::collections::HashSet::new();
    for m in messages {
        let Some(Value::Array(parts)) = m.get("content") else {
            continue;
        };
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("tool-call") {
                continue;
            }
            let name = part.get("toolName").and_then(Value::as_str).unwrap_or("");
            if is_mutation_tool(name) {
                if let Some(p) = part.get("input").and_then(path_of_input) {
                    paths.insert(p);
                }
            }
        }
    }
    paths
}

fn collect_last_read_idx_per_path(messages: &[Value]) -> std::collections::HashMap<String, usize> {
    let mut last = std::collections::HashMap::new();
    for (i, m) in messages.iter().enumerate() {
        let Some(Value::Array(parts)) = m.get("content") else {
            continue;
        };
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("tool-call") {
                continue;
            }
            if part.get("toolName").and_then(Value::as_str) != Some("read_file") {
                continue;
            }
            if let Some(p) = part.get("input").and_then(path_of_input) {
                last.insert(p, i);
            }
        }
    }
    last
}

/// Drop/supersede reads whose results are stale (file was mutated, or a later
/// read of the same path exists). Returns the updated list + whether anything
/// changed.
fn drop_superseded_reads(messages: &[Value]) -> (Vec<Value>, bool) {
    let mutated = collect_mutation_paths(messages);
    let last_read_idx = collect_last_read_idx_per_path(messages);

    let mut call_idx_to_path: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for (i, m) in messages.iter().enumerate() {
        let Some(Value::Array(parts)) = m.get("content") else {
            continue;
        };
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("tool-call") {
                continue;
            }
            if part.get("toolName").and_then(Value::as_str) != Some("read_file") {
                continue;
            }
            let Some(p) = part.get("input").and_then(path_of_input) else {
                continue;
            };
            let id = part
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !id.is_empty() {
                call_idx_to_path.insert(id.to_string(), p);
            }
            let _ = i;
        }
    }

    let mut touched = false;
    let mut out = Vec::with_capacity(messages.len());
    for (i, m) in messages.iter().enumerate() {
        let Some(Value::Array(parts)) = m.get("content") else {
            out.push(m.clone());
            continue;
        };
        let mut local = false;
        let mut next_parts = Vec::with_capacity(parts.len());
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("tool-result") {
                next_parts.push(part.clone());
                continue;
            }
            let id = part
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(path) = call_idx_to_path.get(id) else {
                next_parts.push(part.clone());
                continue;
            };
            let is_stale = mutated.contains(path)
                || (last_read_idx
                    .get(path)
                    .map(|last| *last > i)
                    .unwrap_or(false));
            if !is_stale {
                next_parts.push(part.clone());
                continue;
            }
            let (changed, elided) = elide_tool_result(part);
            if changed {
                local = true;
            }
            next_parts.push(elided);
        }
        if !local {
            out.push(m.clone());
        } else {
            touched = true;
            let mut next = m.clone();
            next.as_object_mut().map(|o| o.insert("content".to_string(), Value::Array(next_parts)));
            out.push(next);
        }
    }
    (out, touched)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactResult {
    pub messages: Vec<Value>,
    pub compacted: bool,
    pub dropped_count: usize,
}

/// Legacy compaction: elide stale reads, then elide tool results from the
/// non-tail prefix until under 0.6x budget.
pub fn compact_model_messages_detailed(
    messages: &[Value],
    context_limit: u64,
) -> CompactResult {
    let mut dropped = 0usize;
    let mut working = messages.to_vec();
    let mut tokens = approx_tokens(&working);

    if tokens >= context_limit * 55 / 100 {
        let (r, touched) = drop_superseded_reads(&working);
        if touched {
            working = r;
            dropped += 1;
            tokens = approx_tokens(&working);
        }
    }

    if tokens < context_limit * 7 / 10 {
        return CompactResult {
            messages: working,
            compacted: dropped > 0,
            dropped_count: dropped,
        };
    }

    let stop_idx = working.len().saturating_sub(KEEP_TAIL);
    for i in 0..stop_idx {
        let Some(Value::Array(parts)) = working[i].get("content") else {
            continue;
        };
        if working[i].get("role").and_then(Value::as_str) == Some("system") {
            continue;
        }
        let mut local = false;
        let mut next_parts = Vec::with_capacity(parts.len());
        for part in parts {
            let (changed, elided) = elide_tool_result(part);
            if changed {
                local = true;
            }
            next_parts.push(elided);
        }
        if local {
            if let Some(o) = working[i].as_object_mut() {
                o.insert("content".to_string(), Value::Array(next_parts));
            }
            dropped += 1;
            if approx_tokens(&working) < context_limit * 6 / 10 {
                break;
            }
        }
    }

    CompactResult {
        messages: working,
        compacted: dropped > 0,
        dropped_count: dropped,
    }
}

/// 2/4 selectContext: run compaction honoring head/tail protection zones.
pub fn select_context(
    messages: &[Value],
    context_limit: u64,
    protect_first: usize,
    protect_last: usize,
) -> CompactResult {
    let full = compact_model_messages_detailed(messages, context_limit);

    let mut head_restored = full.messages.clone();
    for i in 0..protect_first.min(messages.len()) {
        if i < head_restored.len() && messages[i] != head_restored[i] {
            head_restored[i] = messages[i].clone();
        }
    }

    let tail_idx = messages.len().saturating_sub(protect_last);
    let mut tail_restored = head_restored;
    for i in tail_idx..messages.len() {
        if i < tail_restored.len() && messages[i] != tail_restored[i] {
            tail_restored[i] = messages[i].clone();
        }
    }

    CompactResult {
        messages: tail_restored,
        compacted: full.compacted,
        dropped_count: full.dropped_count,
    }
}

/// 3/4 debounce gate: stop compressing after two consecutive low-savings
/// passes ( context_compressor anti-thrash).
#[derive(Debug, Clone)]
pub struct CompressionDebouncer {
    min_saved_pct: u64,
    consecutive_saves_below: u32,
}

impl CompressionDebouncer {
    pub fn new(min_saved_pct: u64) -> Self {
        Self {
            min_saved_pct,
            consecutive_saves_below: 0,
        }
    }

    pub fn record_compression(&mut self, saved_pct: u64) {
        self.consecutive_saves_below = if saved_pct < self.min_saved_pct {
            self.consecutive_saves_below + 1
        } else {
            0
        };
    }

    pub fn should_compress(&self) -> bool {
        self.consecutive_saves_below < 2
    }

    pub fn reset(&mut self) {
        self.consecutive_saves_below = 0;
    }
}

/// 4/4 pruneToolResultsOnly: elide ONLY oversized tool results without touching
/// message structure. Head/tail zones honored.
pub fn prune_tool_results_only(
    messages: &[Value],
    protect_first: usize,
    protect_last: usize,
) -> (Vec<Value>, bool) {
    let last_start = protect_first.max(messages.len().saturating_sub(protect_last));
    let mut changed = false;
    let mut out = Vec::with_capacity(messages.len());
    for (i, m) in messages.iter().enumerate() {
        if i < protect_first || i >= last_start {
            out.push(m.clone());
            continue;
        }
        let Some(Value::Array(parts)) = m.get("content") else {
            out.push(m.clone());
            continue;
        };
        let mut local = false;
        let mut next_parts = Vec::with_capacity(parts.len());
        for part in parts {
            let (c, elided) = elide_tool_result(part);
            if c {
                local = true;
            }
            next_parts.push(elided);
        }
        if !local {
            out.push(m.clone());
        } else {
            changed = true;
            let mut next = m.clone();
            if let Some(o) = next.as_object_mut() {
                o.insert("content".to_string(), Value::Array(next_parts));
            }
            out.push(next);
        }
    }
    if changed {
        (out, true)
    } else {
        (messages.to_vec(), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: Value) -> Value {
        json!({ "role": role, "content": content })
    }

    fn read_call(id: &str, path: &str) -> Value {
        msg(
            "assistant",
            json!([{ "type": "tool-call", "toolCallId": id, "toolName": "read_file", "input": { "path": path } }]),
        )
    }

    fn read_result(id: &str, value: &str) -> Value {
        msg(
            "tool",
            json!([{ "type": "tool-result", "toolCallId": id, "output": { "type": "text", "value": value } }]),
        )
    }

    fn write_call(id: &str, path: &str) -> Value {
        msg(
            "assistant",
            json!([{ "type": "tool-call", "toolCallId": id, "toolName": "write_file", "input": { "path": path } }]),
        )
    }

    fn tool_result_msg(id: &str, value: &str) -> Value {
        read_result(id, value)
    }

    fn output_of(m: &Value) -> &Value {
        m["content"][0]["output"].as_object().map(|_| &m["content"][0]["output"]).unwrap()
    }

    fn is_elided(m: &Value) -> bool {
        output_of(m).get("__elided").and_then(Value::as_bool) == Some(true)
    }

    fn big() -> String {
        "x".repeat(2000)
    }

    #[test]
    fn returns_input_when_it_fits_budget() {
        let messages = vec![msg("user", Value::String("hi".into()))];
        let r = compact_model_messages_detailed(&messages, 1000);
        assert!(!r.compacted);
        assert_eq!(r.messages, messages);
    }

    #[test]
    fn elides_read_result_once_file_written() {
        let messages = vec![
            read_call("c1", "/a.txt"),
            read_result("c1", &big()),
            write_call("c2", "/a.txt"),
            msg("user", Value::String(big())),
        ];
        let r = compact_model_messages_detailed(&messages, 1000);
        assert!(r.compacted);
        assert!(is_elided(&r.messages[1]));
    }

    #[test]
    fn keeps_latest_read_elides_superseded() {
        let messages = vec![
            read_call("c1", "/a.txt"),
            read_result("c1", &big()),
            read_call("c2", "/a.txt"),
            read_result("c2", &big()),
            msg("user", Value::String(big())),
        ];
        let r = compact_model_messages_detailed(&messages, 1000);
        assert!(is_elided(&r.messages[1]));
        assert!(!is_elided(&r.messages[3]));
    }

    #[test]
    fn no_elide_under_budget() {
        let messages = vec![
            read_call("c1", "/a.txt"),
            read_result("c1", "tiny"),
            read_call("c2", "/a.txt"),
            read_result("c2", "tiny"),
        ];
        let r = compact_model_messages_detailed(&messages, 100_000);
        assert!(!r.compacted);
        assert!(!is_elided(&r.messages[1]));
    }

    #[test]
    fn idempotent_rerun() {
        let messages = vec![
            read_call("c1", "/a.txt"),
            read_result("c1", &big()),
            write_call("c2", "/a.txt"),
            msg("user", Value::String(big())),
        ];
        let once = compact_model_messages_detailed(&messages, 1000);
        let twice = compact_model_messages_detailed(&once.messages, 1000);
        assert!(!twice.compacted);
        assert!(is_elided(&twice.messages[1]));
    }

    #[test]
    fn should_compress_threshold() {
        assert!(should_compress(700, 1000));
        assert!(!should_compress(690, 1000));
    }

    #[test]
    fn select_context_protects_head_and_tail() {
        let mut messages = vec![
            msg("user", Value::String("header".into())),
            msg("assistant", Value::String("a1".into())),
            msg("user", Value::String("a2".into())),
        ];
        for i in 0..12 {
            messages.push(tool_result_msg(&format!("c{i}"), &big()));
        }
        messages.push(msg("user", Value::String("tail".into())));
        let r = select_context(&messages, 500, PROTECT_FIRST_N, PROTECT_LAST_N);
        let last = r.messages.last().unwrap();
        assert_eq!(last["content"], "tail");
        assert_eq!(r.messages[0]["content"], "header");
        assert_eq!(r.messages[PROTECT_FIRST_N - 1]["content"], "a2");
    }

    #[test]
    fn select_context_elides_middle_under_pressure() {
        let mut messages = vec![
            msg("user", Value::String("header".into())),
            msg("assistant", Value::String("a1".into())),
            msg("user", Value::String("a2".into())),
        ];
        for i in 0..40 {
            messages.push(tool_result_msg(&format!("c{i}"), &big()));
        }
        messages.push(msg("user", Value::String("tail".into())));

        let r = select_context(&messages, 200, PROTECT_FIRST_N, PROTECT_LAST_N);
        let mut elided = 0usize;
        let mut kept_big = 0usize;
        for m in &r.messages {
            let Some(Value::Array(parts)) = m.get("content") else {
                continue;
            };
            for p in parts {
                if p.get("type").and_then(Value::as_str) != Some("tool-result") {
                    continue;
                }
                if p.get("output").and_then(|o| o.get("__elided")).and_then(Value::as_bool) == Some(true) {
                    elided += 1;
                } else {
                    kept_big += 1;
                }
            }
        }
        assert!(elided > 10);
        assert!(kept_big < 30);
        assert_eq!(r.messages[0]["content"], "header");
        assert_eq!(r.messages.last().unwrap()["content"], "tail");
    }

    #[test]
    fn debouncer_stops_after_two_low_savings() {
        let mut d = CompressionDebouncer::new(10);
        assert!(d.should_compress());
        d.record_compression(5);
        assert!(d.should_compress());
        d.record_compression(4);
        assert!(!d.should_compress());
    }

    #[test]
    fn debouncer_resets_after_high_savings() {
        let mut d = CompressionDebouncer::new(10);
        d.record_compression(5);
        d.record_compression(20);
        d.record_compression(5);
        assert!(d.should_compress());
    }

    #[test]
    fn debouncer_explicit_reset() {
        let mut d = CompressionDebouncer::new(10);
        d.record_compression(1);
        d.record_compression(1);
        assert!(!d.should_compress());
        d.reset();
        assert!(d.should_compress());
    }

    #[test]
    fn prune_tool_results_only_elides_middle_keeps_structure() {
        let messages = vec![
            msg("user", Value::String("q0".into())),
            msg("user", Value::String("q1".into())),
            msg("user", Value::String("q2".into())),
            tool_result_msg("c", &big()),
            msg("user", Value::String("after".into())),
            msg("user", Value::String("after2".into())),
            msg("user", Value::String("after3".into())),
            msg("user", Value::String("after4".into())),
            msg("user", Value::String("after5".into())),
            msg("user", Value::String("after6".into())),
        ];
        let (out, changed) = prune_tool_results_only(&messages, PROTECT_FIRST_N, PROTECT_LAST_N);
        assert!(changed);
        assert!(is_elided(&out[3]));
        assert_eq!(out[0]["content"], "q0");
        assert_eq!(out[4]["content"], "after");
    }

    #[test]
    fn prune_tool_results_only_no_change_when_nothing_oversized() {
        let messages = vec![
            msg("user", Value::String("q".into())),
            msg("user", Value::String("small".into())),
        ];
        let (out, changed) = prune_tool_results_only(&messages, PROTECT_FIRST_N, PROTECT_LAST_N);
        assert!(!changed);
        assert_eq!(out, messages);
    }
}

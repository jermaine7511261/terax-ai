//! Multi-agent subsystem (P2): capability_mode intersection, depth limiting,
//! summary budget cap, and output-schema validation. Mirrors 
//! `CapabilityMode`/`intersect_capability_modes`, the frontend
//! `runSubagent`/`delegateMany` budgets, and omp `outputSchema` validation.

pub mod agent_def;
pub mod agent_registry;
pub mod capability;
pub mod context_modifier;
pub mod lifecycle;
pub mod platform;
pub mod replay;
pub mod schema;
pub mod skill_fork;
pub mod templates;
pub mod trace;

pub use agent_def::{
    AgentDef, AgentHooks, AgentMemoryConfig, AgentMode, ApprovalPolicy, MemoryScope, ToolScope,
};
pub use agent_registry::{AgentRegistry, AgentSource};
pub use context_modifier::{
    apply_context_modifier, merge_modifiers, AgentRuntimeConfig, ContextModifier,
};
pub use lifecycle::{AgentInstance, AgentLifecycleManager, AgentRunRecord, AgentState, StepRecord, TokenUsage};
pub use skill_fork::{derive_agent_from_skill, SkillSource};
pub use templates::{builtin_templates, clone_template};
pub use trace::{AgentTrace, SpanKind, SpanStatus, TraceRecorder, TraceSpan};

/// Hard ceiling on delegation depth ( `subagents_max_depth` / 
/// `max_spawn_depth`). A subagent's workers inherit depth+1; beyond this the
/// `task` tool is stripped so infinite nesting is impossible.
pub const MAX_SPAWN_DEPTH: u32 = 3;

/// Prose summary budget cap ( summary-budget-cap). Raised from 4000 so
/// real research/audit summaries survive; the parent's context compaction
/// handles overflow instead. Applied via `cap_summary` — prose is cut at a
/// sentence boundary, structured output (deep_search JSON) stays intact.
pub const SUBAGENT_SUMMARY_CAP: usize = 16_000;

/// Hard safety cap for structured output (JSON / fenced blocks). Deep-search
/// researcher/verifier JSON routinely exceeds 4KB and MUST stay parseable, so
/// only a runaway blob beyond this is cut.
pub const STRUCTURED_SUMMARY_CAP: usize = 200_000;

/// Whether `raw` looks like structured output (JSON object/array or a fenced
/// block) that must not be clipped at a prose boundary.
fn is_structured_output(raw: &str) -> bool {
    let t = raw.trim_start();
    if t.starts_with('{') || t.starts_with('[') {
        return true;
    }
    let head = &t[..t.len().min(64)];
    head.starts_with("```")
}

/// Index just after the last sentence/paragraph break within [floor, limit).
fn cut_at_boundary(raw: &str, limit: usize, floor_ratio: f64) -> usize {
    if limit == 0 {
        return 0;
    }
    let head = &raw[..raw.len().min(limit)];
    let floor = ((limit as f64) * floor_ratio) as usize;
    for (needle, add) in [
        ("\n\n", 2usize),
        (". ", 2),
        ("\n", 1),
        (".", 1),
        (" ", 1),
    ] {
        if let Some(idx) = head.rfind(needle) {
            if idx >= floor {
                return (idx + add).min(limit);
            }
        }
    }
    limit
}

/// Cap a subagent summary. Returns the (possibly truncated) text. Structured
/// output is exempted up to `STRUCTURED_SUMMARY_CAP`. Mirrors the frontend
/// `capSummary` in `src/modules/ai/lib/summary.ts`.
pub fn cap_summary(raw: &str, cap: usize) -> String {
    if raw.chars().count() <= cap {
        return raw.to_string();
    }
    if is_structured_output(raw) {
        if raw.chars().count() <= STRUCTURED_SUMMARY_CAP {
            return raw.to_string();
        }
        let head: String = raw.chars().take(STRUCTURED_SUMMARY_CAP).collect();
        return format!("{head}\u{2026}[truncated]");
    }
    let limit = raw
        .char_indices()
        .nth(cap)
        .map(|(i, _)| i)
        .unwrap_or(raw.len());
    let cut = cut_at_boundary(raw, limit, 0.6);
    format!("{}\u{2026}[truncated]", &raw[..cut])
}

/// Whether a worker at `depth` may still spawn `task` (delegate) children.
pub fn can_delegate(depth: u32, max_depth: u32) -> bool {
    depth < max_depth
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_cap_truncates_prose_with_marker() {
        let raw = "A complete finding with details. ".repeat(500);
        let out = cap_summary(&raw, SUBAGENT_SUMMARY_CAP);
        assert!(out.contains("\u{2026}[truncated]"));
        // Boundary-aware: never ends mid-word.
        let cut = out.trim_end_matches("\u{2026}[truncated]");
        assert!(cut.ends_with(". ") || cut.ends_with(". ") || cut.ends_with('\n') || cut.ends_with(' '));
        assert!(out.chars().count() <= SUBAGENT_SUMMARY_CAP + 20);
    }

    #[test]
    fn summary_cap_short_passes_through() {
        assert_eq!(cap_summary("hello", 10), "hello");
    }

    #[test]
    fn summary_cap_keeps_structured_json_intact() {
        let json = format!("{}{}", "{\"claims\":", "{},".repeat(10_000));
        assert!(json.chars().count() > SUBAGENT_SUMMARY_CAP);
        // Deep-search JSON beyond the prose cap must pass through uncut.
        assert_eq!(cap_summary(&json, 100), json);
    }

    #[test]
    fn summary_cap_cuts_runaway_structured_blob() {
        let huge = format!("{}]", "[".to_string() + &"x".repeat(STRUCTURED_SUMMARY_CAP + 10));
        let out = cap_summary(&huge, 100);
        assert!(out.contains("\u{2026}[truncated]"));
        assert!(out.chars().count() <= STRUCTURED_SUMMARY_CAP + 20);
    }

    #[test]
    fn delegation_depth_gate() {
        assert!(can_delegate(0, MAX_SPAWN_DEPTH));
        assert!(can_delegate(2, MAX_SPAWN_DEPTH));
        assert!(!can_delegate(3, MAX_SPAWN_DEPTH));
        assert!(!can_delegate(9, 3));
    }
}

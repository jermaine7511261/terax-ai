//! Multi-agent subsystem (P2): capability_mode intersection, depth limiting,
//! summary budget cap, and output-schema validation. Mirrors grok
//! `CapabilityMode`/`intersect_capability_modes`, the frontend
//! `runSubagent`/`delegateMany` budgets, and omp `outputSchema` validation.

pub mod capability;
pub mod schema;

/// Hard ceiling on delegation depth (grok `subagents_max_depth` / hermes
/// `max_spawn_depth`). A subagent's workers inherit depth+1; beyond this the
/// `task` tool is stripped so infinite nesting is impossible.
pub const MAX_SPAWN_DEPTH: u32 = 3;

/// Summary budget cap (hermes summary-budget-cap): a child's returned summary
/// longer than this is truncated to a head excerpt + a truncation marker.
pub const SUBAGENT_SUMMARY_CAP: usize = 4000;

/// Truncate a subagent summary to the budget cap with an explicit marker.
pub fn cap_summary(raw: &str, cap: usize) -> String {
    if raw.chars().count() <= cap {
        return raw.to_string();
    }
    let head: String = raw.chars().take(cap).collect();
    format!("{head}\u{2026}[truncated to {cap} chars]")
}

/// Whether a worker at `depth` may still spawn `task` (delegate) children.
pub fn can_delegate(depth: u32, max_depth: u32) -> bool {
    depth < max_depth
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_cap_truncates_with_marker() {
        let raw = "x".repeat(5000);
        let out = cap_summary(&raw, SUBAGENT_SUMMARY_CAP);
        assert_eq!(out.chars().count(), SUBAGENT_SUMMARY_CAP + 1 + "[truncated to 4000 chars]".chars().count());
        assert!(out.contains("[truncated to 4000 chars]"));
    }

    #[test]
    fn summary_cap_short_passes_through() {
        assert_eq!(cap_summary("hello", 10), "hello");
    }

    #[test]
    fn delegation_depth_gate() {
        assert!(can_delegate(0, MAX_SPAWN_DEPTH));
        assert!(can_delegate(2, MAX_SPAWN_DEPTH));
        assert!(!can_delegate(3, MAX_SPAWN_DEPTH));
        assert!(!can_delegate(9, 3));
    }
}

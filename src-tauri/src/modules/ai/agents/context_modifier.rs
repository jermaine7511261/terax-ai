//! Context modifier (R28 #8). Mirrors Flock's `ContextModifier`: a tool call
//! (or harness step) can DYNAMICALLY adjust the running agent's behavior —
//! switch the model, change reasoning effort, restrict the toolset, or toggle
//! plan mode. The pure merge function is the single source of truth; the
//! harness applies it between steps.

use serde::{Deserialize, Serialize};

/// Runtime-adjustable agent settings. Model/tools default to the agent def;
/// a modifier overrides them for the remainder of the run.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeConfig {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    /// Tool whitelist; empty = all tools allowed.
    pub allowed_tools: Vec<String>,
    pub plan_mode: bool,
}

impl AgentRuntimeConfig {
    /// Whether `tool` is permitted under the current whitelist (empty = all).
    pub fn allows(&self, tool: &str) -> bool {
        self.allowed_tools.is_empty() || self.allowed_tools.iter().any(|t| t == tool)
    }
}

/// A delta applied to the runtime config. All fields optional; `None` leaves
/// the current value untouched. `set_allowed_tools` replaces the whitelist.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextModifier {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub set_allowed_tools: Option<Vec<String>>,
    pub plan_mode: Option<bool>,
}

/// Apply a modifier onto a runtime config. Pure — unit-tested.
pub fn apply_context_modifier(
    current: &AgentRuntimeConfig,
    modifier: &ContextModifier,
) -> AgentRuntimeConfig {
    let mut next = current.clone();
    if modifier.model.is_some() {
        next.model = modifier.model.clone();
    }
    if modifier.reasoning_effort.is_some() {
        next.reasoning_effort = modifier.reasoning_effort.clone();
    }
    if let Some(tools) = &modifier.set_allowed_tools {
        next.allowed_tools = tools.clone();
    }
    if let Some(pm) = modifier.plan_mode {
        next.plan_mode = pm;
    }
    next
}

/// Merge a sequence of modifiers (later wins per field).
pub fn merge_modifiers(modifiers: &[ContextModifier]) -> AgentRuntimeConfig {
    let mut cfg = AgentRuntimeConfig::default();
    for m in modifiers {
        cfg = apply_context_modifier(&cfg, m);
    }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_overrides_selected_fields_only() {
        let base = AgentRuntimeConfig::default();
        let m = ContextModifier {
            model: Some("deepseek-v4-pro".into()),
            reasoning_effort: None,
            set_allowed_tools: None,
            plan_mode: Some(true),
        };
        let next = apply_context_modifier(&base, &m);
        assert_eq!(next.model.as_deref(), Some("deepseek-v4-pro"));
        assert_eq!(next.reasoning_effort, None); // untouched
        assert!(next.plan_mode);
        assert!(next.allowed_tools.is_empty());
    }

    #[test]
    fn apply_replaces_toolset() {
        let base = AgentRuntimeConfig {
            allowed_tools: vec!["read_file".into()],
            ..Default::default()
        };
        let m = ContextModifier {
            set_allowed_tools: Some(vec!["grep".into(), "glob".into()]),
            ..Default::default()
        };
        let next = apply_context_modifier(&base, &m);
        assert!(next.allows("grep"));
        assert!(!next.allows("read_file"));
    }

    #[test]
    fn allows_empty_means_all() {
        let cfg = AgentRuntimeConfig::default();
        assert!(cfg.allows("anything"));
    }

    #[test]
    fn merge_later_wins() {
        let out = merge_modifiers(&[
            ContextModifier { model: Some("m1".into()), ..Default::default() },
            ContextModifier { model: Some("m2".into()), reasoning_effort: Some("high".into()), ..Default::default() },
        ]);
        assert_eq!(out.model.as_deref(), Some("m2"));
        assert_eq!(out.reasoning_effort.as_deref(), Some("high"));
    }
}

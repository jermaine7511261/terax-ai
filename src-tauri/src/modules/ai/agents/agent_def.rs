//! Agent definition schema (R28 #1). The first-principle of the agent
//! platform: it decides how rich an agent's behavior can be. Mirrors the
//! seven-project intersection ( / Flock /  /  /
//! Claude-code / ) — identity, model, tools, execution, control — with
//! optional advanced sections (memory / knowledge / plan / approval / hooks).

use serde::{Deserialize, Serialize};

pub type AgentId = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    /// Delegatable worker (default).
    Subagent,
    /// Selectable as the main chat agent.
    Primary,
    /// Runs but is hidden from selectors.
    Hidden,
}

/// Tool visibility scope for an agent.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ToolScope {
    /// Every registered tool.
    #[default]
    All,
    /// Only the named tools.
    AllowList(Vec<String>),
    /// All tools except these.
    DenyList(Vec<String>),
    /// Reference a named toolset.
    Named(String),
}

/// Memory behavior for an agent instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryConfig {
    pub recall: bool,
    pub auto_save: bool,
    pub scope: MemoryScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    Session,
    Workspace,
    Global,
}

/// Approval policy for the agent's tool calls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalPolicy {
    Default,
    Always,
    Never,
}

/// Lifecycle hooks invoked by the agent runtime.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentHooks {
    pub on_start: Option<String>,
    pub on_end: Option<String>,
    pub on_error: Option<String>,
}

/// A complete agent definition. `id` is the stable key; everything else is
/// configurable from built-in, workspace, or user sources.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentDef {
    // identity
    pub id: AgentId,
    pub name: String,
    pub description: String,
    // model
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    // prompt
    pub system_prompt: String,
    // tools
    pub tools: ToolScope,
    // execution
    pub max_steps: Option<u32>,
    pub max_tokens: Option<u32>,
    pub budget_cap: Option<f64>,
    // control
    pub mode: AgentMode,
    pub enabled: bool,
    // optional advanced
    pub memory: Option<AgentMemoryConfig>,
    pub knowledge: Option<String>,
    pub plan_mode: bool,
    pub approval: Option<ApprovalPolicy>,
    pub hooks: Option<AgentHooks>,
    // UI
    pub color: Option<String>,
    pub icon: Option<String>,
}

impl Default for AgentDef {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            description: String::new(),
            model: None,
            reasoning_effort: None,
            system_prompt: String::new(),
            tools: ToolScope::default(),
            max_steps: None,
            max_tokens: None,
            budget_cap: None,
            mode: AgentMode::Subagent,
            enabled: true,
            memory: None,
            knowledge: None,
            plan_mode: false,
            approval: None,
            hooks: None,
            color: None,
            icon: None,
        }
    }
}

impl AgentDef {
    /// Effective max steps: explicit value or the platform default (24).
    pub fn effective_max_steps(&self, default_max_steps: u32) -> u32 {
        self.max_steps.unwrap_or(default_max_steps).max(1)
    }

    /// Whether this agent may be offered in a delegatable-worker picker.
    pub fn is_delegatable(&self) -> bool {
        self.enabled && matches!(self.mode, AgentMode::Subagent)
    }

    /// Whether this agent may be offered in the main-chat picker.
    pub fn is_primary(&self) -> bool {
        self.enabled && matches!(self.mode, AgentMode::Primary)
    }

    /// Whether `tool_name` is allowed by this agent's tool scope.
    pub fn allows_tool(&self, tool_name: &str) -> bool {
        match &self.tools {
            ToolScope::All => true,
            ToolScope::AllowList(list) => list.iter().any(|t| t == tool_name),
            ToolScope::DenyList(list) => !list.iter().any(|t| t == tool_name),
            ToolScope::Named(_) => true, // resolved by the registry
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> AgentDef {
        AgentDef {
            id: "code-reviewer".into(),
            name: "Code Reviewer".into(),
            description: "Reviews diffs".into(),
            system_prompt: "You review code.".into(),
            tools: ToolScope::AllowList(vec!["read_file".into(), "grep".into()]),
            mode: AgentMode::Subagent,
            ..Default::default()
        }
    }

    #[test]
    fn serde_roundtrip_preserves_every_field() {
        let def = sample();
        let json = serde_json::to_string(&def).unwrap();
        let back: AgentDef = serde_json::from_str(&json).unwrap();
        assert_eq!(def, back);
    }

    #[test]
    fn defaults_are_safe() {
        let def = AgentDef::default();
        assert!(def.enabled);
        assert_eq!(def.mode, AgentMode::Subagent);
        assert!(matches!(def.tools, ToolScope::All));
        assert_eq!(def.effective_max_steps(24), 24);
    }

    #[test]
    fn delegatable_and_primary_filters() {
        let sub = sample();
        assert!(sub.is_delegatable());
        assert!(!sub.is_primary());
        let mut primary = sample();
        primary.mode = AgentMode::Primary;
        // Per the platform contract, Primary is NOT offered to delegated
        // pickers (only the main-chat picker).
        assert!(!primary.is_delegatable());
        assert!(primary.is_primary());
        let mut hidden = sample();
        hidden.mode = AgentMode::Hidden;
        assert!(!hidden.is_delegatable());
        let mut disabled = sample();
        disabled.enabled = false;
        assert!(!disabled.is_delegatable());
    }

    #[test]
    fn tool_scope_filters() {
        let def = sample();
        assert!(def.allows_tool("read_file"));
        assert!(!def.allows_tool("bash_run"));
        let deny = AgentDef {
            tools: ToolScope::DenyList(vec!["bash_run".into()]),
            ..sample()
        };
        assert!(deny.allows_tool("read_file"));
        assert!(!deny.allows_tool("bash_run"));
    }

    #[test]
    fn max_steps_respects_floor() {
        let def = AgentDef {
            max_steps: Some(0),
            ..Default::default()
        };
        assert_eq!(def.effective_max_steps(24), 1);
    }
}

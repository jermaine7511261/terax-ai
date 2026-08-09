//! Skill fork (R28 #13, Flock `spawn_fork()`): derive an independent sub-agent
//! from a skill. The skill's prompt becomes the agent's system prompt and its
//! tool allowlist becomes the agent's ToolScope — so a skill can be executed
//! as a self-contained agent with its own model/effort/tools overrides.

use super::agent_def::{AgentDef, AgentMode, AgentId, ToolScope};

/// Minimal view of a skill file (mirrors `ai/skills.rs` fields we need).
pub struct SkillSource {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub tool_allowlist: Vec<String>,
}

/// Derive a new AgentDef from a skill. Pure — unit-tested.
pub fn derive_agent_from_skill(
    skill: &SkillSource,
    new_id: &AgentId,
    model_override: Option<String>,
    reasoning_effort: Option<String>,
) -> AgentDef {
    AgentDef {
        id: new_id.clone(),
        name: format!("skill:{}", skill.name),
        description: if skill.description.is_empty() {
            format!("Runs the skill `{}`.", skill.name)
        } else {
            skill.description.clone()
        },
        system_prompt: skill.prompt.clone(),
        tools: if skill.tool_allowlist.is_empty() {
            ToolScope::All
        } else {
            ToolScope::AllowList(skill.tool_allowlist.clone())
        },
        model: model_override,
        reasoning_effort,
        mode: AgentMode::Subagent,
        enabled: true,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill() -> SkillSource {
        SkillSource {
            name: "fix-ts".into(),
            description: "Fix TS errors".into(),
            prompt: "Run pnpm check-types and fix".into(),
            tool_allowlist: vec!["bash_run".into(), "edit".into()],
        }
    }

    #[test]
    fn derives_agent_with_skill_prompt_and_toolset() {
        let def = derive_agent_from_skill(&skill(), &"s-fork-1".into(), None, None);
        assert_eq!(def.id, "s-fork-1");
        assert_eq!(def.system_prompt, "Run pnpm check-types and fix");
        assert!(matches!(def.tools, ToolScope::AllowList(ref l) if l == &vec!["bash_run".to_string(), "edit".to_string()]));
        assert!(def.is_delegatable());
    }

    #[test]
    fn applies_model_and_effort_overrides() {
        let def = derive_agent_from_skill(
            &skill(),
            &"s-fork-2".into(),
            Some("deepseek-v4-pro".into()),
            Some("high".into()),
        );
        assert_eq!(def.model.as_deref(), Some("deepseek-v4-pro"));
        assert_eq!(def.reasoning_effort.as_deref(), Some("high"));
    }

    #[test]
    fn empty_toolset_means_all() {
        let mut s = skill();
        s.tool_allowlist = vec![];
        let def = derive_agent_from_skill(&s, &"s-fork-3".into(), None, None);
        assert!(matches!(def.tools, ToolScope::All));
    }
}

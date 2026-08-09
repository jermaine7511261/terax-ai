//! Agent templates (R28 #12,  `from_template()`): reusable agent
//! definitions you clone into a new agent with a new id. Built-in templates
//! cover common roles; user templates are plain AgentDef JSONs in the user
//! agents dir. The core is pure + unit-tested.

use super::agent_def::{AgentDef, AgentMode, ToolScope};

/// Built-in starter templates. Cloning applies the template then lets the
/// caller override id/name/description/model.
pub fn builtin_templates() -> Vec<AgentDef> {
    vec![
        template(
            "tpl:researcher",
            "Researcher",
            "Independent web researcher that gathers and cites sources.",
            r#"You are an independent researcher. Break the question into sub-questions,
search the web (web_search + fetch_url), and synthesize a cited markdown answer.
Always cite your sources with URLs."#,
            vec!["web_search", "fetch_url", "read_file", "grep", "glob"],
        ),
        template(
            "tpl:auditor",
            "Auditor",
            "Rigorous correctness + security audit of a code change.",
            r#"You are a meticulous auditor. Review diffs for correctness, edge cases,
race conditions, security, and data integrity. Output MUST/SHOULD/NIT findings
with file:line and a concrete fix."#,
            vec![
                "read_file",
                "grep",
                "glob",
                "git_diff",
                "git_blame",
                "bash_run",
            ],
        ),
        template(
            "tpl:reproducer",
            "Reproducer",
            "Turns a reported bug into a minimal failing reproduction.",
            r#"You are a bug reproducer. Read the issue context, inspect the repo, write the
smallest reproduction that demonstrates the failure, and report the exact
command + expected vs actual output."#,
            vec![
                "read_file",
                "grep",
                "glob",
                "bash_run",
                "write_file",
                "edit",
            ],
        ),
    ]
}

fn template(
    id: &str,
    name: &str,
    description: &str,
    system_prompt: &str,
    tools: Vec<&str>,
) -> AgentDef {
    AgentDef {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        system_prompt: system_prompt.to_string(),
        tools: ToolScope::AllowList(tools.into_iter().map(str::to_string).collect()),
        mode: AgentMode::Subagent,
        enabled: true,
        ..Default::default()
    }
}

/// Clone a template into a new agent definition. Pure — unit-tested.
pub fn clone_template(template: &AgentDef, new_id: &str, name: Option<&str>) -> AgentDef {
    let mut def = template.clone();
    def.id = new_id.to_string();
    if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
        def.name = n.trim().to_string();
    }
    def
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_templates_are_valid() {
        for t in builtin_templates() {
            assert!(!t.id.is_empty());
            assert!(!t.system_prompt.is_empty());
            assert!(t.enabled);
        }
    }

    #[test]
    fn clone_assigns_new_id_and_optional_name() {
        let tpl = &builtin_templates()[0];
        let cloned = clone_template(tpl, "my-researcher", Some("My Researcher"));
        assert_eq!(cloned.id, "my-researcher");
        assert_eq!(cloned.name, "My Researcher");
        assert_eq!(cloned.system_prompt, tpl.system_prompt);
        // No name → keep template name.
        let cloned2 = clone_template(tpl, "r2", None);
        assert_eq!(cloned2.name, tpl.name);
    }
}

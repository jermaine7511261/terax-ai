//! Skill subsystem (P1): native skill.json parse/validate + safe name/path
//! handling for `create_skill`, mirroring the frontend `lib/skills.ts` and
//! `tools/createSkill.ts` contracts so existing test behavior is preserved.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_allowlist: Option<Vec<String>>,
    /// S6: tools this skill requires to function (frontmatter `requires_tools`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_tools: Option<Vec<String>>,
    /// S6: env vars this skill requires (frontmatter `requires_env`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_env: Option<Vec<String>>,
    /// S6: `fallback_for_tools` — when one of these tools is missing, the
    /// skill should not be injected (its body presumes that tool).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_for_tools: Option<Vec<String>>,
    #[serde(default)]
    pub agent_created: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_ts: Option<u64>,
    #[serde(default)]
    pub usage_count: u64,
    #[serde(default)]
    pub archived: bool,
}

/// S6 activation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum SkillState {
    Active,
    Degraded,
    Unavailable,
}

/// S6 prompt budget (PraisonAI `SkillPromptBudget`).
pub const SKILL_MAX_CHARS: usize = 4096;
pub const SKILL_MAX_COUNT: usize = 50;

/// Decide a skill's activation state given which tools/env are available.
/// - All requirements present → Active.
/// - Some missing but no `fallback_for_tools` hit → Degraded (still inject).
/// - A tool listed in `fallback_for_tools` is missing → Unavailable (skip
///   injection — its body presumes that tool).
pub fn skill_state(skill: &SkillFile, available_tools: &[String], available_env: &[String]) -> SkillState {
    let has_tool = |t: &str| available_tools.iter().any(|a| a == t);
    let has_env = |e: &str| available_env.iter().any(|a| a == e);

    let missing_tools: Vec<&str> = skill
        .requires_tools
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(String::as_str)
        .filter(|t| !has_tool(t))
        .collect();
    let missing_env: Vec<&str> = skill
        .requires_env
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(String::as_str)
        .filter(|e| !has_env(e))
        .collect();

    let fallback_hit = skill
        .fallback_for_tools
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .any(|t| !has_tool(t));

    if fallback_hit {
        return SkillState::Unavailable;
    }
    if !missing_tools.is_empty() || !missing_env.is_empty() {
        return SkillState::Degraded;
    }
    SkillState::Active
}

/// Truncate a skill body to the prompt budget (chars), with a marker.
pub fn cap_skill_body(body: &str, max_chars: usize) -> String {
    if body.chars().count() <= max_chars {
        return body.to_string();
    }
    let head: String = body.chars().take(max_chars).collect();
    format!("{head}…[truncated]")
}

/// Parse + validate a skill.json payload; returns `None` when malformed
/// (missing/invalid name or prompt). Mirrors `parseSkillJson`.
pub fn parse_skill_json(raw: &str) -> Option<SkillFile> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let o = v.as_object()?;
    let name = o.get("name").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
    let prompt = o.get("prompt").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
    if name.is_empty() || prompt.is_empty() {
        return None;
    }
    let description = o.get("description").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
    let handle = o.get("handle").and_then(serde_json::Value::as_str).map(normalize_handle);
    let tool_allowlist = o
        .get("toolAllowlist")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        });
    let string_list = |k: &str| {
        o.get(k)
            .and_then(serde_json::Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
    };
    Some(SkillFile {
        name,
        description,
        prompt,
        handle: handle.filter(|h| !h.is_empty()),
        tool_allowlist,
        requires_tools: string_list("requiresTools"),
        requires_env: string_list("requiresEnv"),
        fallback_for_tools: string_list("fallbackForTools"),
        agent_created: o.get("agent_created").and_then(serde_json::Value::as_bool).unwrap_or(false),
        created_at: o.get("created_at").and_then(serde_json::Value::as_u64),
        activity_ts: o.get("activity_ts").and_then(serde_json::Value::as_u64),
        usage_count: o.get("usage_count").and_then(serde_json::Value::as_u64).unwrap_or(0),
        archived: o.get("archived").and_then(serde_json::Value::as_bool).unwrap_or(false),
    })
}

/// Normalize an invocation handle (mirrors the frontend `normalizeHandle`):
/// trim → lowercase → whitespace runs become `-` → strip everything except
/// `[a-z0-9-]` (underscores are removed) → collapse dashes → trim leading
/// dashes.
pub fn normalize_handle(input: &str) -> String {
    let trimmed = input.trim().to_ascii_lowercase();
    let mut out = String::new();
    let mut last_was_space = false;
    for c in trimmed.chars() {
        if c.is_whitespace() {
            if !last_was_space && !out.is_empty() {
                out.push('-');
                last_was_space = true;
            }
        } else if c.is_ascii_alphanumeric() || c == '-' {
            out.push(c);
            last_was_space = false;
        } else {
            // Non-allowed char (underscore, symbol): drop it, mark a dash seam.
            last_was_space = true;
        }
    }
    let mut out = out.trim_matches('-').to_string();
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out
}

const HANDLE_RE_LEN: usize = 63;

/// Validate a skill create payload. Returns an error string or `None` when
/// valid. Mirrors `validateSkillFields`.
pub fn validate_skill_fields(input: &SkillCreateInput) -> Option<String> {
    if input.name.trim().is_empty() {
        return Some("skill name cannot be empty".into());
    }
    if input.prompt.trim().is_empty() {
        return Some("skill prompt cannot be empty".into());
    }
    if let Some(h) = input.handle.as_deref().map(str::trim).filter(|h| !h.is_empty()) {
        let ok = !h.is_empty()
            && h.len() <= HANDLE_RE_LEN
            && h.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && h.chars().last().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && h
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
        if !ok {
            return Some(format!(
                "invalid handle '{h}': must match /^[a-z0-9][a-z0-9_-]{{0,62}}[a-z0-9]$/"
            ));
        }
    }
    if let Some(list) = &input.tool_allowlist {
        if list.iter().any(|t| t.trim().is_empty()) {
            return Some("toolAllowlist must contain only non-empty strings".into());
        }
    }
    None
}

#[derive(Debug, Default, Clone)]
pub struct SkillCreateInput {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub handle: Option<String>,
    pub tool_allowlist: Option<Vec<String>>,
}

/// Sanitize a skill directory/file name to `[a-zA-Z0-9._-]` (mirrors the
/// frontend `safeName`).
pub fn safe_skill_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Reject skill names that would escape the skills directory or collide with
/// hidden/system entries. Checks the raw name for path separators / traversal
/// before sanitization (a `../x` or `a/b` must never reach the fs layer).
pub fn skill_name_is_safe(name: &str) -> bool {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
    {
        return false;
    }
    !safe_skill_name(name).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_skill_json() {
        let raw = r#"{"name":"fix-ts","description":"Fix TS errors","prompt":"Run pnpm check-types and fix","handle":"fixTs","toolAllowlist":["bash_run"],"agent_created":true,"usage_count":3}"#;
        let s = parse_skill_json(raw).unwrap();
        assert_eq!(s.name, "fix-ts");
        assert_eq!(s.handle.as_deref(), Some("fixts"));
        assert_eq!(s.tool_allowlist.as_deref(), Some(["bash_run".to_string()].as_slice()));
        assert!(s.agent_created);
        assert_eq!(s.usage_count, 3);
    }

    #[test]
    fn parse_rejects_missing_name_or_prompt() {
        assert!(parse_skill_json(r#"{"description":"x"}"#).is_none());
        assert!(parse_skill_json(r#"{"name":"x"}"#).is_none());
        assert!(parse_skill_json(r#"{"name":"  ","prompt":"p"}"#).is_none());
        assert!(parse_skill_json(r#"{"name":"n","prompt":"  "}"#).is_none());
        assert!(parse_skill_json("not json").is_none());
    }

    #[test]
    fn parse_tolerates_missing_optional_fields() {
        let s = parse_skill_json(r#"{"name":"n","prompt":"p"}"#).unwrap();
        assert_eq!(s.description, "");
        assert!(s.handle.is_none());
        assert!(!s.archived);
        assert_eq!(s.usage_count, 0);
    }

    #[test]
    fn normalize_handle_lowercases_and_collapses() {
        assert_eq!(normalize_handle("Fix-TS Errors"), "fix-ts-errors");
        assert_eq!(normalize_handle("  deploy  app  "), "deploy-app");
        assert_eq!(normalize_handle("UPPER"), "upper");
        assert_eq!(normalize_handle("a__b"), "ab");
        assert_eq!(normalize_handle("a  b"), "a-b");
        assert_eq!(normalize_handle("-leading-"), "leading");
    }

    #[test]
    fn validate_skill_fields_checks_rules() {
        assert!(validate_skill_fields(&SkillCreateInput {
            name: "x".into(),
            prompt: "p".into(),
            ..Default::default()
        })
        .is_none());
        assert!(validate_skill_fields(&SkillCreateInput {
            name: "".into(),
            prompt: "p".into(),
            ..Default::default()
        })
        .is_some());
        assert!(validate_skill_fields(&SkillCreateInput {
            name: "x".into(),
            prompt: "".into(),
            ..Default::default()
        })
        .is_some());
        // Handle with uppercase is invalid.
        assert!(validate_skill_fields(&SkillCreateInput {
            name: "x".into(),
            prompt: "p".into(),
            handle: Some("Bad".into()),
            ..Default::default()
        })
        .is_some());
        // Empty allowlist entries rejected.
        assert!(validate_skill_fields(&SkillCreateInput {
            name: "x".into(),
            prompt: "p".into(),
            tool_allowlist: Some(vec!["ok".into(), "  ".into()]),
            ..Default::default()
        })
        .is_some());
    }

    #[test]
    fn safe_name_and_safety_guard() {
        assert_eq!(safe_skill_name("My Skill!"), "My_Skill_");
        assert!(skill_name_is_safe("my-skill"));
        assert!(skill_name_is_safe("a.b"));
        assert!(!skill_name_is_safe(".."));
        assert!(!skill_name_is_safe("."));
        assert!(!skill_name_is_safe(".hidden"));
        assert!(!skill_name_is_safe("a/b"));
        assert!(!skill_name_is_safe("a\\b"));
        assert!(!skill_name_is_safe(""));
    }

    #[test]
    fn parse_requires_and_fallback_fields() {
        let raw = r#"{"name":"deploy","prompt":"deploy it","requiresTools":["bash_run"],"requiresEnv":["AWS_ACCESS_KEY_ID"],"fallbackForTools":["docker"]}"#;
        let s = parse_skill_json(raw).unwrap();
        assert_eq!(s.requires_tools.as_deref(), Some(["bash_run".to_string()].as_slice()));
        assert_eq!(s.requires_env.as_deref(), Some(["AWS_ACCESS_KEY_ID".to_string()].as_slice()));
        assert_eq!(s.fallback_for_tools.as_deref(), Some(["docker".to_string()].as_slice()));
    }

    #[test]
    fn skill_state_all_requirements_met_is_active() {
        let s = parse_skill_json(r#"{"name":"d","prompt":"p","requiresTools":["bash_run"]}"#).unwrap();
        assert_eq!(
            skill_state(&s, &["bash_run".to_string()], &[]),
            SkillState::Active
        );
    }

    #[test]
    fn skill_state_missing_requirement_is_degraded() {
        let s = parse_skill_json(r#"{"name":"d","prompt":"p","requiresEnv":["FOO"]}"#).unwrap();
        assert_eq!(skill_state(&s, &[], &[]), SkillState::Degraded);
        let t = parse_skill_json(r#"{"name":"d","prompt":"p","requiresTools":["git_commit"]}"#).unwrap();
        assert_eq!(skill_state(&t, &["read_file".to_string()], &[]), SkillState::Degraded);
    }

    #[test]
    fn skill_state_fallback_tool_missing_is_unavailable() {
        let s = parse_skill_json(r#"{"name":"d","prompt":"p","fallbackForTools":["docker"]}"#).unwrap();
        assert_eq!(skill_state(&s, &["read_file".to_string()], &[]), SkillState::Unavailable);
    }

    #[test]
    fn skill_state_no_requirements_is_active() {
        let s = parse_skill_json(r#"{"name":"d","prompt":"p"}"#).unwrap();
        assert_eq!(skill_state(&s, &[], &[]), SkillState::Active);
    }

    #[test]
    fn cap_skill_body_truncates_at_budget() {
        let short = "short body";
        assert_eq!(cap_skill_body(short, 100), short);
        let long = "x".repeat(5000);
        let capped = cap_skill_body(&long, SKILL_MAX_CHARS);
        assert_eq!(
            capped.chars().count(),
            SKILL_MAX_CHARS + 1 + "[truncated]".chars().count()
        );
        assert!(capped.contains("[truncated]"));
    }
}

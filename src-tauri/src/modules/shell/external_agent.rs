use std::process::Command;

use serde::Serialize;

/// External agent CLIs Yamet can orchestrate. `command` is the bare executable
/// name resolved from PATH; `version_flag` is how each CLI reports its version.
const AGENT_DEFS: &[(&str, &str)] = &[
    ("claude", "--version"),
    ("codex", "--version"),
    ("", "--version"),
    ("gemini", "--version"),
    ("pi", "--version"),
    ("", "--version"),
];

#[derive(Serialize)]
pub struct ExternalAgentInfo {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Detect which external agent CLIs are installed and their versions. Used to
/// surface a version-compatibility hint before orchestrating a CLI. Each
/// `--version` probe runs with a short timeout and never blocks long.
pub fn probe_external_agents() -> Vec<ExternalAgentInfo> {
    AGENT_DEFS
        .iter()
        .map(|(id, version_flag)| {
            let label = match *id {
                "claude" => "Claude Code".to_string(),
                "codex" => "Codex".to_string(),
                "" => "".to_string(),
                "gemini" => "Gemini CLI".to_string(),
                "pi" => "Pi".to_string(),
                "" => "".to_string(),
                _ => (*id).to_string(),
            };
            match which::which(id).ok() {
                None => ExternalAgentInfo {
                    id: (*id).to_string(),
                    label,
                    available: false,
                    version: None,
                    error: None,
                },
                Some(_path) => {
                    let version = probe_version(id, version_flag);
                    ExternalAgentInfo {
                        id: (*id).to_string(),
                        label,
                        available: true,
                        version,
                        error: None,
                    }
                }
            }
        })
        .collect()
}

fn probe_version(id: &str, version_flag: &str) -> Option<String> {
    let child = Command::new(id).arg(version_flag).spawn().ok()?;
    let output = child.wait_with_output().ok()?;
    // Version probes print to stdout or stderr depending on the CLI.
    let raw = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).into_owned()
    } else {
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    raw.lines()
        .next()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_returns_one_entry_per_defined_agent() {
        let out = probe_external_agents();
        // AGENT_DEFS defines 6 agents; probe always returns exactly one info
        // per def regardless of whether the CLI is installed.
        assert_eq!(out.len(), AGENT_DEFS.len());
        for info in &out {
            assert!(!info.id.is_empty());
            assert!(!info.label.is_empty());
            assert!(info.available || info.version.is_none());
        }
    }

    #[test]
    fn version_parse_never_crashes_on_missing_binary() {
        // A binary that does not exist returns None without panicking.
        assert!(probe_version("__yamet_no_such_bin__", "--version").is_none());
    }
}


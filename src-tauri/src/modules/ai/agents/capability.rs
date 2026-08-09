//! Capability modes (P2): ReadOnly / ReadWrite / Execute / All + intersection
//! (a child can never exceed its parent). Mirrors 
//! `capability.rs::CapabilityMode` + `overrides.rs::intersect_capability_modes`
//! and the frontend `kind_allowed`-style tool filtering.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityMode {
    ReadOnly,
    ReadWrite,
    Execute,
    All,
}

impl CapabilityMode {
    /// Intersection: the child's effective capability is the weaker of the
    /// two, so a subagent can never do more than its parent allowed.
    pub fn intersect(self, other: CapabilityMode) -> CapabilityMode {
        self.min(other)
    }

    /// Whether a tool name is permitted under this capability.
    pub fn allows(&self, tool: &str) -> bool {
        match self {
            CapabilityMode::ReadOnly => matches!(
                tool,
                "read_file"
                    | "list_directory"
                    | "grep"
                    | "glob"
                    | "fs_search"
                    | "fs_grep"
                    | "fs_list_files"
                    | "get_terminal_output"
                    | "web_search"
                    | "fetch_url"
            ),
            CapabilityMode::ReadWrite => {
                self.allows_readonly_union(tool)
                    && !matches!(
                        tool,
                        "bash_run" | "bash_background" | "terminal_execute" | "run_command"
                    )
            }
            CapabilityMode::Execute => true,
            CapabilityMode::All => true,
        }
    }

    fn allows_readonly_union(&self, tool: &str) -> bool {
        // Every readonly tool plus the write/mutate set (no process exec).
        CapabilityMode::ReadOnly.allows(tool)
            || matches!(
                tool,
                "write_file"
                    | "edit"
                    | "multi_edit"
                    | "create_directory"
                    | "rename"
                    | "delete"
                    | "fs_write_file"
                    | "fs_create_file"
                    | "fs_create_dir"
                    | "fs_rename"
                    | "fs_delete"
                    | "create_skill"
            )
    }
}

/// Filter a tool list by a capability ( `kind_allowed` matrix).
pub fn filter_tools_by_capability(tools: &[String], mode: CapabilityMode) -> Vec<String> {
    tools.iter().filter(|t| mode.allows(t)).cloned().collect()
}

/// Apply the parent-child capability intersection and strip `task` when the
/// depth cap is exceeded ( `run_shell_child`).
pub fn resolve_subagent_toolset(
    parent: CapabilityMode,
    requested: CapabilityMode,
    child_tools: &[String],
    depth: u32,
    max_depth: u32,
) -> Vec<String> {
    let effective = parent.intersect(requested);
    let mut tools = filter_tools_by_capability(child_tools, effective);
    if depth >= max_depth {
        tools.retain(|t| t != "task" && t != "run_subagent" && t != "delegate_many");
    }
    tools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intersection_is_the_weaker_of_two() {
        assert_eq!(CapabilityMode::All.intersect(CapabilityMode::ReadOnly), CapabilityMode::ReadOnly);
        assert_eq!(CapabilityMode::ReadWrite.intersect(CapabilityMode::Execute), CapabilityMode::ReadWrite);
        assert_eq!(CapabilityMode::Execute.intersect(CapabilityMode::ReadWrite), CapabilityMode::ReadWrite);
        assert_eq!(CapabilityMode::ReadOnly.intersect(CapabilityMode::ReadOnly), CapabilityMode::ReadOnly);
    }

    #[test]
    fn readonly_allows_reads_only() {
        assert!(CapabilityMode::ReadOnly.allows("read_file"));
        assert!(CapabilityMode::ReadOnly.allows("grep"));
        assert!(!CapabilityMode::ReadOnly.allows("write_file"));
        assert!(!CapabilityMode::ReadOnly.allows("bash_run"));
    }

    #[test]
    fn readwrite_allows_mutations_but_not_exec() {
        assert!(CapabilityMode::ReadWrite.allows("write_file"));
        assert!(CapabilityMode::ReadWrite.allows("read_file"));
        assert!(!CapabilityMode::ReadWrite.allows("bash_run"));
        assert!(!CapabilityMode::ReadWrite.allows("terminal_execute"));
    }

    #[test]
    fn execute_and_all_allow_everything() {
        assert!(CapabilityMode::Execute.allows("bash_run"));
        assert!(CapabilityMode::All.allows("anything"));
    }

    #[test]
    fn child_cannot_exceed_parent() {
        // Parent ReadOnly, child requested Execute → effective ReadOnly.
        let tools = vec!["read_file".to_string(), "bash_run".to_string()];
        let filtered = resolve_subagent_toolset(
            CapabilityMode::ReadOnly,
            CapabilityMode::Execute,
            &tools,
            0,
            3,
        );
        assert_eq!(filtered, vec!["read_file".to_string()]);
    }

    #[test]
    fn depth_cap_strips_task_tools() {
        let tools = vec!["read_file".to_string(), "task".to_string(), "run_subagent".to_string()];
        let filtered = resolve_subagent_toolset(
            CapabilityMode::All,
            CapabilityMode::All,
            &tools,
            3,
            3,
        );
        assert_eq!(filtered, vec!["read_file".to_string()]);
    }
}

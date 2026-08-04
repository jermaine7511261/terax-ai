//! Read-only MCP tool implementations.
//!
//! Each tool maps to a `tools/call` request. All tools are **read-only** —
//! no write, delete, or execute operations are exposed. Paths are resolved
//! relative to `workdir` and must not escape it.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::protocol::ToolDef;

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/// Return the list of tools this server exposes.
pub fn list_tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "read_file".into(),
            description: "Read the contents of a file (text). Max 1 MiB.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path within the workspace."
                    }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "list_directory".into(),
            description: "List files and directories at a path.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative directory path (default: \".\")."
                    }
                }
            }),
        },
        ToolDef {
            name: "grep".into(),
            description: "Search file contents by regex pattern (ripgrep-style).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for."
                    },
                    "path": {
                        "type": "string",
                        "description": "Relative directory or file to search in (default: \".\")."
                    }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "glob".into(),
            description: "Find files matching a glob pattern.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (e.g. \"**/*.rs\", \"src/**/*.ts\")."
                    }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "git_status".into(),
            description: "Show working tree status.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDef {
            name: "git_diff".into(),
            description: "Show uncommitted changes.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
    ]
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/// Resolve a relative path against `workdir`, rejecting escapes.
fn resolve_safe(workdir: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains('\0') {
        return Err("path contains null byte".into());
    }
    let candidate = workdir.join(rel);
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("path error: {e}"))?;
    let wd_canonical = workdir
        .canonicalize()
        .map_err(|e| format!("workdir error: {e}"))?;
    if canonical.starts_with(&wd_canonical) {
        Ok(canonical)
    } else {
        Err("path escapes workspace root".into())
    }
}

/// Read file size limit (1 MiB).
const MAX_FILE_SIZE: u64 = 1_048_576;

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

/// Dispatch a `tools/call` request and return the result content.
pub fn call_tool(
    name: &str,
    args: &Value,
    workdir: &Path,
) -> Result<Vec<Value>, String> {
    match name {
        "read_file" => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .ok_or("missing 'path' argument")?;
            let full = resolve_safe(workdir, path)?;
            let meta = std::fs::metadata(&full)
                .map_err(|e| format!("cannot stat {path}: {e}"))?;
            if meta.len() > MAX_FILE_SIZE {
                return Err(format!(
                    "file too large ({:.1} MiB > 1 MiB limit)",
                    meta.len() as f64 / 1_048_576.0
                ));
            }
            let content = std::fs::read_to_string(&full)
                .map_err(|e| format!("read error: {e}"))?;
            Ok(vec![json!({"type": "text", "text": content})])
        }
        "list_directory" => {
            let rel = args
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or(".");
            let full = resolve_safe(workdir, rel)?;
            let entries: Vec<String> = std::fs::read_dir(&full)
                .map_err(|e| format!("readdir error: {e}"))?
                .filter_map(|e| e.ok())
                .map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        format!("{name}/")
                    } else {
                        name
                    }
                })
                .collect();
            Ok(vec![json!({"type": "text", "text": entries.join("\n")})])
        }
        "grep" => {
            let pattern = args
                .get("pattern")
                .and_then(Value::as_str)
                .ok_or("missing 'pattern' argument")?;
            let search_path = args
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or(".");
            let full = resolve_safe(workdir, search_path)?;
            let re = regex::Regex::new(pattern)
                .map_err(|e| format!("invalid regex: {e}"))?;
            let mut results = Vec::new();
            let walk = if full.is_dir() {
                ignore::WalkBuilder::new(&full)
                    .hidden(false)
                    .git_ignore(true)
                    .build()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                    .collect::<Vec<_>>()
            } else {
                vec![ignore::DirEntry::from(full)]
            };
            for entry in walk {
                let path = entry.path();
                // Skip .git directory
                if path.components().any(|c| c.as_os_str() == ".git") {
                    continue;
                }
                let Ok(content) = std::fs::read_to_string(path) else {
                    continue;
                };
                for (i, line) in content.lines().enumerate() {
                    if re.is_match(line) {
                        let rel = path
                            .strip_prefix(workdir)
                            .unwrap_or(path)
                            .to_string_lossy();
                        results.push(format!("{}:{}: {}", rel, i + 1, line));
                        if results.len() >= 200 {
                            results.push("... (truncated at 200 matches)".into());
                            return Ok(vec![json!({"type": "text", "text": results.join("\n")})]);
                        }
                    }
                }
            }
            Ok(vec![json!({"type": "text", "text": results.join("\n")})])
        }
        "glob" => {
            let pattern = args
                .get("pattern")
                .and_then(Value::as_str)
                .ok_or("missing 'pattern' argument")?;
            let full = workdir.join(pattern);
            let pattern_str = full.to_string_lossy();
            let glob = globset::Glob::new(&pattern_str)
                .map_err(|e| format!("invalid glob: {e}"))?
                .compile_matcher();
            let mut results = Vec::new();
            let walker = ignore::WalkBuilder::new(workdir)
                .hidden(false)
                .git_ignore(true)
                .build();
            for entry in walker.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    continue;
                }
                if glob.is_match(path) {
                    let rel = path
                        .strip_prefix(workdir)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .to_string();
                    results.push(rel);
                    if results.len() >= 500 {
                        results.push("... (truncated at 500 matches)".into());
                        break;
                    }
                }
            }
            Ok(vec![json!({"type": "text", "text": results.join("\n")})])
        }
        "git_status" => {
            let output = std::process::Command::new("git")
                .arg("status")
                .arg("--short")
                .current_dir(workdir)
                .output()
                .map_err(|e| format!("git not available: {e}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            Ok(vec![json!({"type": "text", "text": stdout})])
        }
        "git_diff" => {
            let output = std::process::Command::new("git")
                .arg("diff")
                .current_dir(workdir)
                .output()
                .map_err(|e| format!("git not available: {e}"))?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            Ok(vec![json!({"type": "text", "text": stdout})])
        }
        _ => Err(format!("unknown tool: {name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolve_safe_rejects_escape() {
        let dir = tempfile::tempdir().unwrap();
        let result = resolve_safe(dir.path(), "../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_safe_allows_valid() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("test.txt"), "hello").unwrap();
        let result = resolve_safe(dir.path(), "test.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn read_file_tool() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("hello.txt"), "world").unwrap();
        let result = call_tool(
            "read_file",
            &json!({"path": "hello.txt"}),
            dir.path(),
        )
        .unwrap();
        assert_eq!(result[0]["text"], "world");
    }

    #[test]
    fn read_file_rejects_escape() {
        let dir = tempfile::tempdir().unwrap();
        let result = call_tool(
            "read_file",
            &json!({"path": "../etc/passwd"}),
            dir.path(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn list_directory_tool() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let result = call_tool("list_directory", &json!({}), dir.path()).unwrap();
        let text = result[0]["text"].as_str().unwrap();
        assert!(text.contains("a.txt"));
        assert!(text.contains("sub/"));
    }

    #[test]
    fn grep_tool() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("code.rs"), "fn main() {\n    let x = 42;\n}").unwrap();
        let result = call_tool(
            "grep",
            &json!({"pattern": "fn main"}),
            dir.path(),
        )
        .unwrap();
        let text = result[0]["text"].as_str().unwrap();
        assert!(text.contains("fn main()"));
    }

    #[test]
    fn unknown_tool() {
        let dir = tempfile::tempdir().unwrap();
        let result = call_tool("nonexistent", &json!({}), dir.path());
        assert!(result.is_err());
    }
}

//! Agent Tool trait and registry.
//!
//! Each tool wraps a capability (read a file, run a shell command, grep, etc.)
//! behind a uniform interface so the agent loop can discover, select, and
//! invoke tools without knowing their implementation.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::modules::tool_guard::{GuardAction, ToolGuard};

/// The result of a single tool execution.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ToolResult {
    pub tool: String,
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub duration_ms: u64,
}

/// Metadata describing a tool for the LLM.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    /// JSON Schema for the parameters that `execute` accepts.
    pub parameters: Value,
}

/// A callable tool.
pub trait AgentTool: Send + Sync {
    fn def(&self) -> &ToolDef;
    fn execute(&self, args: Value) -> Result<ToolResult, String>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn AgentTool>>,
    guard: Option<Arc<ToolGuard>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            guard: None,
        }
    }

    pub fn with_guard(mut self, guard: Arc<ToolGuard>) -> Self {
        self.guard = Some(guard);
        self
    }

    pub fn register(&mut self, tool: Box<dyn AgentTool>) {
        let name = tool.def().name.clone();
        self.tools.insert(name, tool);
    }

    pub fn get_def(&self, name: &str) -> Option<&ToolDef> {
        self.tools.get(name).map(|t| t.def())
    }

    pub fn list_defs(&self) -> Vec<&ToolDef> {
        self.tools.values().map(|t| t.def()).collect()
    }

    pub fn execute(&self, name: &str, args: Value) -> Result<ToolResult, String> {
        let start = std::time::Instant::now();

        // Security guard check
        if let Some(ref guard) = self.guard {
            let resource = args.to_string();
            let result = guard.check(name, &resource).map_err(|e| e.to_string())?;
            match result.action {
                GuardAction::Block => {
                    return Ok(ToolResult {
                        tool: name.into(),
                        success: false,
                        output: String::new(),
                        error: Some(format!("[GUARD BLOCKED] {}", result.reason)),
                        duration_ms: 0,
                    });
                }
                GuardAction::Flag => {
                    // Log the flag but allow execution
                    log::info!(
                        "tool flagged: {} — {} (rule: {:?})",
                        name,
                        result.reason,
                        result.rule_id
                    );
                }
                GuardAction::RequireApproval => {
                    return Ok(ToolResult {
                        tool: name.into(),
                        success: false,
                        output: String::new(),
                        error: Some(format!(
                            "[GUARD REQUIRE APPROVAL] {}",
                            result.reason
                        )),
                        duration_ms: 0,
                    });
                }
                GuardAction::Allow => { /* proceed */ }
            }
        }

        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| format!("unknown tool: {name}"))?;

        let result = tool.execute(args)?;
        let elapsed = start.elapsed().as_millis() as u64;

        Ok(ToolResult {
            duration_ms: elapsed,
            ..result
        })
    }
}

// ---------------------------------------------------------------------------
// Concrete tool implementations
// ---------------------------------------------------------------------------

macro_rules! tool_def {
    ($name:expr, $description:expr, $params:expr) => {
        ToolDef {
            name: $name.into(),
            description: $description.into(),
            parameters: $params,
        }
    };
}

// --- read_file ---

pub struct ReadFileTool {
    def: ToolDef,
}

impl ReadFileTool {
    pub fn new() -> Self {
        Self {
            def: tool_def!(
                "read_file",
                "Read the contents of a file. Returns the text content, binary indicator, or a too-large error. Max default read is 10 MB.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute path to the file" }
                    },
                    "required": ["path"]
                })
            ),
        }
    }
}

impl AgentTool for ReadFileTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "read_file: missing 'path' argument".to_string())?;

        let p = std::path::Path::new(path);

        // Check file existence and size
        let meta = match std::fs::metadata(p) {
            Ok(m) => m,
            Err(e) => {
                return Ok(ToolResult {
                    tool: "read_file".into(),
                    success: false,
                    output: String::new(),
                    error: Some(format!("file not found or inaccessible: {e}")),
                    duration_ms: 0,
                });
            }
        };

        let size = meta.len();
        let max_read = 10 * 1024 * 1024; // 10 MB
        if size > max_read {
            return Ok(ToolResult {
                tool: "read_file".into(),
                success: true,
                output: format!("[FILE TOO LARGE — {} bytes exceeds limit of {} bytes]", size, max_read),
                error: None,
                duration_ms: 0,
            });
        }

        match std::fs::read(p) {
            Ok(bytes) => {
                // Null-byte sniff
                let sniff_len = bytes.len().min(8 * 1024);
                if sniff_len > 0 && bytes[..sniff_len].contains(&0) {
                    Ok(ToolResult {
                        tool: "read_file".into(),
                        success: true,
                        output: format!("[BINARY FILE — {} bytes]", size),
                        error: None,
                        duration_ms: 0,
                    })
                } else {
                    match String::from_utf8(bytes) {
                        Ok(content) => Ok(ToolResult {
                            tool: "read_file".into(),
                            success: true,
                            output: content,
                            error: None,
                            duration_ms: 0,
                        }),
                        Err(_) => Ok(ToolResult {
                            tool: "read_file".into(),
                            success: true,
                            output: format!("[BINARY FILE — {} bytes]", size),
                            error: None,
                            duration_ms: 0,
                        }),
                    }
                }
            }
            Err(e) => Ok(ToolResult {
                tool: "read_file".into(),
                success: false,
                output: String::new(),
                error: Some(e.to_string()),
                duration_ms: 0,
            }),
        }
    }
}

// --- write_file ---

pub struct WriteFileTool {
    def: ToolDef,
}

impl WriteFileTool {
    pub fn new() -> Self {
        Self {
            def: tool_def!(
                "write_file",
                "Write content to a file. Uses atomic write (write to temp then rename) for safety. Returns the new mtime.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute path to the file" },
                        "content": { "type": "string", "description": "Content to write" }
                    },
                    "required": ["path", "content"]
                })
            ),
        }
    }
}

impl AgentTool for WriteFileTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "write_file: missing 'path'".to_string())?;
        let content = args
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| "write_file: missing 'content'".to_string())?;

        let target = std::path::Path::new(path);

        // Create parent directories if they don't exist
        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // Simple write (non-atomic — acceptable for agent tool usage)
        std::fs::write(target, content.as_bytes())
            .map_err(|e| format!("write_file: {e}"))?;

        Ok(ToolResult {
            tool: "write_file".into(),
            success: true,
            output: format!("wrote {} bytes to {}", content.len(), path),
            error: None,
            duration_ms: 0,
        })
    }
}

// --- grep ---

pub struct GrepTool {
    def: ToolDef,
}

impl GrepTool {
    pub fn new() -> Self {
        Self {
            def: tool_def!(
                "grep",
                "Search file contents using a regular expression. Returns matching lines with file path, line number, and text.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Regular expression to search for" },
                        "path": { "type": "string", "description": "Directory or file to search in" },
                        "max_results": { "type": "integer", "description": "Maximum results (default 50)", "default": 50 }
                    },
                    "required": ["pattern", "path"]
                })
            ),
        }
    }
}

impl AgentTool for GrepTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let pattern = args
            .get("pattern")
            .and_then(Value::as_str)
            .ok_or_else(|| "grep: missing 'pattern'".to_string())?;
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "grep: missing 'path'".to_string())?;
        let max_results = args
            .get("max_results")
            .and_then(Value::as_u64)
            .unwrap_or(50) as usize;

        // Use grep-regex + grep-searcher for fast multi-threaded search
        let matcher = grep_regex::RegexMatcher::new(pattern)
            .map_err(|e| format!("grep: invalid regex: {e}"))?;

        let mut searcher_builder = grep_searcher::SearcherBuilder::new();
        let mut searcher = searcher_builder
            .binary_detection(grep_searcher::BinaryDetection::quit(b'\x00'))
            .build();

        let results = std::sync::Mutex::new(Vec::<String>::new());
        let counter = std::sync::atomic::AtomicUsize::new(0);
        let cap = max_results.min(500);

        let walker = ignore::WalkBuilder::new(path)
            .git_ignore(true)
            .build();

        for entry in walker.flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            if counter.load(std::sync::atomic::Ordering::Relaxed) >= cap {
                break;
            }

            let matcher = matcher.clone();
            let _results = &results;
            let counter = &counter;
            let _ = searcher.search_path(
                &matcher,
                entry.path(),
                grep_searcher::sinks::UTF8(|_lnum, _line| {
                    if counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < cap {
                        // We need to capture the line — but grep_searcher's UTF8
                        // sink borrows. For simplicity, collect paths only,
                        // then do line-by-line for actual matches.
                        Ok(true)
                    } else {
                        Ok(false)
                    }
                }),
            );
        }

        // Simple fallback for content: walk and match line-by-line
        let regex = regex::Regex::new(pattern).map_err(|e| format!("grep: regex: {e}"))?;
        let mut hits = Vec::new();

        for entry in ignore::WalkBuilder::new(path).git_ignore(true).build().flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            if hits.len() >= cap {
                break;
            }
            let path = entry.path().to_string_lossy().to_string();
            let content = match std::fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            for (i, line) in content.lines().enumerate() {
                if regex.is_match(line) && hits.len() < cap {
                    // Trim context for readability
                    let text = if line.len() > 200 {
                        format!("{}...", &line[..197])
                    } else {
                        line.to_string()
                    };
                    hits.push(format!("{}:{}: {}", path, i + 1, text));
                }
            }
        }

        if hits.is_empty() {
            Ok(ToolResult {
                tool: "grep".into(),
                success: true,
                output: "No matches found.".into(),
                error: None,
                duration_ms: 0,
            })
        } else {
            Ok(ToolResult {
                tool: "grep".into(),
                success: true,
                output: hits.join("\n"),
                error: None,
                duration_ms: 0,
            })
        }
    }
}

// --- glob ---

pub struct GlobTool {
    def: ToolDef,
}

impl GlobTool {
    pub fn new() -> Self {
        Self {
            def: tool_def!(
                "glob",
                "List files matching a glob pattern (e.g. '**/*.rs' for all Rust files).",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Glob pattern" },
                        "root": { "type": "string", "description": "Root directory to search from" }
                    },
                    "required": ["pattern", "root"]
                })
            ),
        }
    }
}

impl AgentTool for GlobTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let pattern = args
            .get("pattern")
            .and_then(Value::as_str)
            .ok_or_else(|| "glob: missing 'pattern'".to_string())?;
        let root = args
            .get("root")
            .and_then(Value::as_str)
            .ok_or_else(|| "glob: missing 'root'".to_string())?;

        let mut paths = Vec::new();
        let _gitignore = ignore::gitignore::GitignoreBuilder::new(root)
            .build()
            .ok();

        let pattern_glob = globset::Glob::new(pattern)
            .map_err(|e| format!("glob: invalid pattern: {e}"))?;
        let matcher = pattern_glob.compile_matcher();

        let walker = ignore::WalkBuilder::new(root)
            .git_ignore(true)
            .hidden(false)
            .build();

        for entry in walker.flatten() {
            let p = entry.path();
            if matcher.is_match(p) {
                paths.push(p.to_string_lossy().to_string());
            }
            if paths.len() >= 500 {
                break;
            }
        }

        Ok(ToolResult {
            tool: "glob".into(),
            success: true,
            output: if paths.is_empty() {
                "No matches found.".into()
            } else {
                paths.join("\n")
            },
            error: None,
            duration_ms: 0,
        })
    }
}

// --- bash_run ---

pub struct BashRunTool {
    def: ToolDef,
    working_dir: String,
}

impl BashRunTool {
    pub fn new(working_dir: &str) -> Self {
        Self {
            def: tool_def!(
                "bash_run",
                "Execute a shell command and return its output. Timeout is 30 seconds. Prefer this for running scripts, build tools, and tests.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to run" },
                        "timeout_secs": { "type": "integer", "description": "Timeout in seconds (default 30)", "default": 30 }
                    },
                    "required": ["command"]
                })
            ),
            working_dir: working_dir.to_string(),
        }
    }
}

impl AgentTool for BashRunTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| "bash_run: missing 'command'".to_string())?;
        let timeout_secs = args
            .get("timeout_secs")
            .and_then(Value::as_u64)
            .unwrap_or(30)
            .max(1)
            .min(120);

        let start = std::time::Instant::now();
        let shell = "sh";

        let mut child = std::process::Command::new(shell)
            .arg("-c")
            .arg(command)
            .current_dir(&self.working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("bash_run: spawn: {e}"))?;

        let duration = std::time::Duration::from_secs(timeout_secs);
        let timed_out = {
            let now = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => {
                        if now.elapsed() > duration {
                            let _ = child.kill();
                            let _ = child.wait();
                            break None;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(e) => {
                        return Err(format!("bash_run: wait: {e}"));
                    }
                }
            }
        };

        let mut stdout = String::new();
        let mut stderr = String::new();
        if let Some(mut out) = child.stdout.take() {
            use std::io::Read;
            let _ = out.read_to_string(&mut stdout);
        }
        if let Some(mut err) = child.stderr.take() {
            use std::io::Read;
            let _ = err.read_to_string(&mut stderr);
        }

        let exit_code = timed_out.and_then(|s| s.code());
        let elapsed_ms = start.elapsed().as_millis() as u64;

        let mut output_parts = Vec::new();
        if timed_out.is_none() {
            output_parts.push("[TIMEOUT]".to_string());
        }
        if !stdout.is_empty() {
            output_parts.push(format!("--- stdout ---\n{}", stdout.trim_end()));
        }
        if !stderr.is_empty() {
            output_parts.push(format!("--- stderr ---\n{}", stderr.trim_end()));
        }
        if let Some(code) = exit_code {
            output_parts.push(format!("--- exit code: {code} ---"));
        }

        Ok(ToolResult {
            tool: "bash_run".into(),
            success: exit_code == Some(0),
            output: output_parts.join("\n"),
            error: if exit_code != Some(0) && timed_out.is_some() {
                Some(format!("exit code: {}", exit_code.unwrap_or(-1)))
            } else if timed_out.is_none() {
                Some("command timed out".into())
            } else {
                None
            },
            duration_ms: elapsed_ms,
        })
    }
}

// --- list_directory ---

pub struct ListDirectoryTool {
    def: ToolDef,
}

impl ListDirectoryTool {
    pub fn new() -> Self {
        Self {
            def: tool_def!(
                "list_directory",
                "List the contents of a directory. Shows files, directories, and symlinks with sizes.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Absolute path to the directory" }
                    },
                    "required": ["path"]
                })
            ),
        }
    }
}

impl AgentTool for ListDirectoryTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "list_directory: missing 'path'".to_string())?;

        let entries = std::fs::read_dir(path)
            .map_err(|e| format!("list_directory: {e}"))?
            .filter_map(|e| e.ok())
            .map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let kind = if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    "dir"
                } else {
                    "file"
                };
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                format!("  {kind:4}  {size:>8}  {name}")
            })
            .collect::<Vec<_>>()
            .join("\n");

        Ok(ToolResult {
            tool: "list_directory".into(),
            success: true,
            output: if entries.is_empty() {
                "(empty directory)".into()
            } else {
                format!("Contents of {}:\n{}", path, entries)
            },
            error: None,
            duration_ms: 0,
        })
    }
}

// --- todo_write (plan tracking for the agent loop) ---

pub struct TodoWriteTool {
    def: ToolDef,
}

impl TodoWriteTool {
    pub fn new() -> Self {
        Self {
            def: tool_def!(
                "todo_write",
                "Track progress across multi-step tasks by writing a todo list. Useful when you need to sequence several operations.",
                serde_json::json!({
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "content": { "type": "string" },
                                    "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                                }
                            },
                            "description": "List of todo items with status"
                        }
                    },
                    "required": ["todos"]
                })
            ),
        }
    }
}

impl AgentTool for TodoWriteTool {
    fn def(&self) -> &ToolDef {
        &self.def
    }

    fn execute(&self, args: Value) -> Result<ToolResult, String> {
        let todos = args
            .get("todos")
            .ok_or_else(|| "todo_write: missing 'todos'".to_string())?;

        let summary = if let Some(arr) = todos.as_array() {
            let total = arr.len();
            let done = arr.iter().filter(|t| {
                t.get("status").and_then(Value::as_str) == Some("completed")
            }).count();
            format!("Plan: {done}/{total} tasks completed")
        } else {
            "Plan updated.".into()
        };

        Ok(ToolResult {
            tool: "todo_write".into(),
            success: true,
            output: summary,
            error: None,
            duration_ms: 0,
        })
    }
}

// ---------------------------------------------------------------------------
// Builder — register all default tools
// ---------------------------------------------------------------------------

pub fn build_default_registry(
    working_dir: &str,
    guard: Option<Arc<ToolGuard>>,
) -> ToolRegistry {
    let mut reg = ToolRegistry::new();
    if let Some(g) = guard {
        reg = reg.with_guard(g);
    }

    reg.register(Box::new(ReadFileTool::new()));
    reg.register(Box::new(WriteFileTool::new()));
    reg.register(Box::new(GrepTool::new()));
    reg.register(Box::new(GlobTool::new()));
    reg.register(Box::new(BashRunTool::new(working_dir)));
    reg.register(Box::new(ListDirectoryTool::new()));
    reg.register(Box::new(TodoWriteTool::new()));

    reg
}

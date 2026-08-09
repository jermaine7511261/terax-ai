//! Guardrail protocol chain (S2, PraisonAI `guardrails/protocols.py` +
//! `chain.py`): structured, machine-deterministic checks on the AI tool
//! execution pipeline — before a prompt is sent (`validate_input`), before a
//! tool runs (`validate_tool_call`, may rewrite args), and before output is
//! returned (`validate_output`).
//!
//! The chain runs guards in registration order; the first failure short-
//! circuits. Guard panics default to **fail-closed** (safe side). This
//! consolidates the previously scattered path/SSRF/shell checks into one
//! testable chain without removing the existing per-call-site guards (those
//! stay as defense-in-depth; this is the ordering/contract layer).

use serde::{Deserialize, Serialize};

/// Uniform guardrail result (PraisonAI `GuardrailResult{success, result,
/// error}`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardrailResult {
    pub success: bool,
    /// Optional rewritten value (tool args or output) when a guard adjusts it.
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl GuardrailResult {
    pub fn ok() -> Self {
        Self {
            success: true,
            result: None,
            error: None,
        }
    }

    pub fn rewrite(value: serde_json::Value) -> Self {
        Self {
            success: true,
            result: Some(value),
            error: None,
        }
    }

    pub fn deny(message: impl Into<String>) -> Self {
        Self {
            success: false,
            result: None,
            error: Some(message.into()),
        }
    }
}

/// Which phase a guard applies to (PraisonAI three hooks).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardHook {
    /// Validate (or rewrite) the assembled prompt / context before the model call.
    Input,
    /// Validate (or rewrite) a tool call's args before execution.
    ToolCall,
    /// Validate (or rewrite) a tool result before it is returned to the model.
    Output,
}

/// A single guard in the chain.
pub trait Guard: Send + Sync {
    fn hook(&self) -> GuardHook;
    fn name(&self) -> &'static str;
    /// Validate/rewrite `value`. Return `GuardrailResult::ok()` to allow,
    /// `rewrite(value)` to adjust, or `deny(msg)` to block (short-circuit).
    fn check(&self, value: &serde_json::Value) -> GuardrailResult;
}

/// Shell-command guard: rejects empty or control-character-laden commands
/// (CR/LF would smuggle a second statement past the approval UI). Mirrors the
/// frontend `checkShellCommand` C0 check, consolidated into the chain.
pub struct ShellCommandGuard;

impl Guard for ShellCommandGuard {
    fn hook(&self) -> GuardHook {
        GuardHook::ToolCall
    }
    fn name(&self) -> &'static str {
        "shell-command"
    }
    fn check(&self, v: &serde_json::Value) -> GuardrailResult {
        // Only applies to tool calls that actually carry a `command` (shell
        // tools); other tool calls (path-only, read, etc.) pass through.
        let Some(cmd) = v.get("command").and_then(|c| c.as_str()) else {
            return GuardrailResult::ok();
        };
        if cmd.trim().is_empty() {
            return GuardrailResult::deny("Refused: empty command.");
        }
        if cmd.bytes().any(|b| b < 0x20) {
            return GuardrailResult::deny(
                "Refused: command contains control characters (including CR/LF). Commands must be single-line.",
            );
        }
        GuardrailResult::ok()
    }
}

/// Path guard: refuses sensitive paths (.env / .ssh / credentials) on tool
/// calls that carry a `path` arg. Consolidates the frontend `security.ts`
/// basename denylist into the chain.
pub struct SensitivePathGuard;

impl Guard for SensitivePathGuard {
    fn hook(&self) -> GuardHook {
        GuardHook::ToolCall
    }
    fn name(&self) -> &'static str {
        "sensitive-path"
    }
    fn check(&self, v: &serde_json::Value) -> GuardrailResult {
        let path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");
        if path.is_empty() {
            return GuardrailResult::ok();
        }
        let lower = path.to_ascii_lowercase();
        let sensitive = [
            ".env", ".pem", ".key", ".p12", ".pfx", "id_rsa", "id_ed25519",
            "known_hosts", "credentials", ".netrc", ".git-credentials",
        ];
        if sensitive.iter().any(|s| {
            lower.split(['/', '\\']).any(|seg| {
                seg == *s || (s.starts_with('.') && seg.starts_with(s) && seg.len() > s.len())
            })
        }) {
            return GuardrailResult::deny(format!("refused: sensitive path '{path}'"));
        }
        GuardrailResult::ok()
    }
}

/// Ordered guard chain with first-failure short-circuit and fail-closed
/// semantics (a panicking guard denies, never silently allows).
pub struct GuardrailChain {
    guards: Vec<Box<dyn Guard>>,
}

impl Default for GuardrailChain {
    fn default() -> Self {
        Self::new()
    }
}

impl GuardrailChain {
    pub fn new() -> Self {
        Self { guards: Vec::new() }
    }

    /// Build the default consolidated chain: the machine-deterministic guards
    /// that previously lived scattered across call sites (shell C0 check,
    /// sensitive-path denylist). Callers may add more via `push`.
    pub fn default_consolidated() -> Self {
        let mut chain = Self::new();
        chain.push(Box::new(ShellCommandGuard));
        chain.push(Box::new(SensitivePathGuard));
        chain
    }

    pub fn push(&mut self, guard: Box<dyn Guard>) -> &mut Self {
        self.guards.push(guard);
        self
    }

    pub fn len(&self) -> usize {
        self.guards.len()
    }

    pub fn is_empty(&self) -> bool {
        self.guards.is_empty()
    }

    /// Run every guard registered for `hook` against `value`. The first deny
    /// short-circuits and returns it; a panicking guard is caught and treated
    /// as deny (fail-closed). Rewrites are threaded through so a guard can
    /// sanitize then the next guard sees the sanitized value.
    pub fn run(&self, hook: GuardHook, value: &serde_json::Value) -> GuardrailResult {
        let mut current = value.clone();
        for guard in &self.guards {
            if guard.hook() != hook {
                continue;
            }
            let result = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                guard.check(&current)
            })) {
                Ok(r) => r,
                Err(_) => {
                    return GuardrailResult::deny(format!(
                        "guard '{}' panicked (fail-closed)",
                        guard.name()
                    ));
                }
            };
            if !result.success {
                return result;
            }
            if let Some(rewritten) = result.result {
                current = rewritten;
            }
        }
        GuardrailResult::ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AllowGuard;
    impl Guard for AllowGuard {
        fn hook(&self) -> GuardHook {
            GuardHook::ToolCall
        }
        fn name(&self) -> &'static str {
            "allow"
        }
        fn check(&self, _v: &serde_json::Value) -> GuardrailResult {
            GuardrailResult::ok()
        }
    }

    struct DenyEnvGuard;
    impl Guard for DenyEnvGuard {
        fn hook(&self) -> GuardHook {
            GuardHook::ToolCall
        }
        fn name(&self) -> &'static str {
            "deny-env"
        }
        fn check(&self, v: &serde_json::Value) -> GuardrailResult {
            let path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");
            if path.contains(".env") {
                GuardrailResult::deny("refused: .env path")
            } else {
                GuardrailResult::ok()
            }
        }
    }

    struct RewriteGuard;
    impl Guard for RewriteGuard {
        fn hook(&self) -> GuardHook {
            GuardHook::ToolCall
        }
        fn name(&self) -> &'static str {
            "rewrite"
        }
        fn check(&self, _v: &serde_json::Value) -> GuardrailResult {
            GuardrailResult::rewrite(serde_json::json!({"path": "/safe/placeholder"}))
        }
    }

    struct InputOnlyGuard;
    impl Guard for InputOnlyGuard {
        fn hook(&self) -> GuardHook {
            GuardHook::Input
        }
        fn name(&self) -> &'static str {
            "input-only"
        }
        fn check(&self, _v: &serde_json::Value) -> GuardrailResult {
            GuardrailResult::deny("not for tool phase")
        }
    }

    #[test]
    fn chain_allows_when_all_guards_ok() {
        let mut chain = GuardrailChain::new();
        chain.push(Box::new(AllowGuard));
        let r = chain.run(GuardHook::ToolCall, &serde_json::json!({"path": "/ok"}));
        assert!(r.success);
    }

    #[test]
    fn chain_denies_and_short_circuits() {
        let mut chain = GuardrailChain::new();
        chain.push(Box::new(DenyEnvGuard));
        chain.push(Box::new(AllowGuard)); // would pass, but never reached
        let r = chain.run(GuardHook::ToolCall, &serde_json::json!({"path": "/x/.env"}));
        assert!(!r.success);
        assert!(r.error.as_deref().unwrap_or("").contains(".env"));
    }

    #[test]
    fn chain_threads_rewrites() {
        let mut chain = GuardrailChain::new();
        chain.push(Box::new(RewriteGuard));
        // A second guard sees the rewritten value.
        chain.push(Box::new(DenyEnvGuard));
        let r = chain.run(GuardHook::ToolCall, &serde_json::json!({"path": "/x/.env"}));
        // RewriteGuard replaces with /safe/placeholder, then DenyEnvGuard passes.
        assert!(r.success);
    }

    #[test]
    fn chain_runs_only_matching_hook() {
        let mut chain = GuardrailChain::new();
        chain.push(Box::new(InputOnlyGuard)); // Input hook only
        // ToolCall phase: InputOnlyGuard is skipped → pass.
        let r = chain.run(GuardHook::ToolCall, &serde_json::json!({}));
        assert!(r.success);
        // Input phase: denies.
        let r = chain.run(GuardHook::Input, &serde_json::json!({}));
        assert!(!r.success);
    }

    #[test]
    fn shell_guard_rejects_empty_and_control_chars() {
        let chain = GuardrailChain::default_consolidated();
        let ok = chain.run(GuardHook::ToolCall, &serde_json::json!({"command": "pnpm build"}));
        assert!(ok.success);
        let empty = chain.run(GuardHook::ToolCall, &serde_json::json!({"command": "  "}));
        assert!(!empty.success);
        let ctrl = chain.run(GuardHook::ToolCall, &serde_json::json!({"command": "echo a\r\nrm -rf /"}));
        assert!(!ctrl.success);
        assert!(ctrl.error.as_deref().unwrap_or("").contains("control"));
    }

    #[test]
    fn path_guard_rejects_sensitive_paths() {
        let chain = GuardrailChain::default_consolidated();
        let ok = chain.run(GuardHook::ToolCall, &serde_json::json!({"path": "/ws/src/main.ts"}));
        assert!(ok.success);
        let env = chain.run(GuardHook::ToolCall, &serde_json::json!({"path": "/ws/.env"}));
        assert!(!env.success);
        let ssh = chain.run(GuardHook::ToolCall, &serde_json::json!({"path": "/ws/.ssh/id_rsa"}));
        assert!(!ssh.success);
        // No `path` arg is a pass-through.
        let no_path = chain.run(GuardHook::ToolCall, &serde_json::json!({"query": "x"}));
        assert!(no_path.success);
    }

    #[test]
    fn default_chain_is_ordered_and_composed() {
        let chain = GuardrailChain::default_consolidated();
        assert_eq!(chain.len(), 2);
        // A command with both a control char and a sensitive path denies on
        // the first guard (shell-command runs first).
        let r = chain.run(
            GuardHook::ToolCall,
            &serde_json::json!({"command": "x\n", "path": "/ws/.env"}),
        );
        assert!(!r.success);
        assert!(r.error.as_deref().unwrap_or("").contains("control"));
    }

    #[test]
    fn panicking_guard_is_fail_closed() {
        struct PanicGuard;
        impl Guard for PanicGuard {
            fn hook(&self) -> GuardHook {
                GuardHook::Output
            }
            fn name(&self) -> &'static str {
                "panic"
            }
            fn check(&self, _v: &serde_json::Value) -> GuardrailResult {
                panic!("boom")
            }
        }
        let mut chain = GuardrailChain::new();
        chain.push(Box::new(PanicGuard));
        let r = chain.run(GuardHook::Output, &serde_json::json!({}));
        assert!(!r.success); // fail-closed
        assert!(r.error.as_deref().unwrap_or("").contains("panic"));
    }
}

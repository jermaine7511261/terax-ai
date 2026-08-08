//! Approval tri-state (P2): once / always / reject + cascading auto-approve
//! (scope memory) + reject feedback. Mirrors the frontend `lib/approval.ts`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalChoice {
    Once,
    Always,
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

/// Scope key for the always-approve memory: a tool id (or tool+args pattern)
/// that the user approved "always" once.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ApprovalScope(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Memory {
    AutoApprove,
    RememberReject,
}

/// Cascading approval store: once the user picks `always` for a scope, all
/// later requests for that scope auto-approve; a `reject` is remembered so
/// the same scope stays denied until the user explicitly approves again.
#[derive(Debug, Default)]
pub struct ApprovalStore {
    memory: HashMap<ApprovalScope, Memory>,
}

impl ApprovalStore {
    pub fn auto_approved(&self, scope: &ApprovalScope) -> bool {
        self.memory.get(scope) == Some(&Memory::AutoApprove)
    }

    fn remembered_reject(&self, scope: &ApprovalScope) -> bool {
        self.memory.get(scope) == Some(&Memory::RememberReject)
    }

    /// Record an `always` decision for a scope. Returns whether the scope was
    /// newly added (vs. already present).
    pub fn set_always(&mut self, scope: ApprovalScope) -> bool {
        self.memory.insert(scope, Memory::AutoApprove).is_none()
    }

    pub fn remember_reject(&mut self, scope: ApprovalScope) {
        self.memory.insert(scope, Memory::RememberReject);
    }

    pub fn forget(&mut self, scope: &ApprovalScope) {
        self.memory.remove(scope);
    }
}

/// Decide the outcome of a request given the store + a fresh user choice.
/// A cached `always` wins over the submitted choice; a submitted `reject` for
/// a previously-`always` scope downgrades it (user overrode the memory).
pub fn decide(
    store: &mut ApprovalStore,
    scope: &ApprovalScope,
    user_choice: Option<ApprovalChoice>,
) -> ApprovalStatus {
    if store.auto_approved(scope) {
        // A fresh reject overrides stale always-memory.
        if user_choice == Some(ApprovalChoice::Reject) {
            store.remember_reject(scope.clone());
            return ApprovalStatus::Rejected;
        }
        return ApprovalStatus::Approved;
    }
    if store.remembered_reject(scope) {
        // An explicit approve unblocks a remembered rejection.
        if matches!(user_choice, Some(ApprovalChoice::Once) | Some(ApprovalChoice::Always)) {
            if user_choice == Some(ApprovalChoice::Always) {
                store.set_always(scope.clone());
            } else {
                store.forget(scope);
            }
            return ApprovalStatus::Approved;
        }
        return ApprovalStatus::Rejected;
    }
    match user_choice {
        Some(ApprovalChoice::Once) | Some(ApprovalChoice::Always) => {
            if user_choice == Some(ApprovalChoice::Always) {
                store.set_always(scope.clone());
            }
            ApprovalStatus::Approved
        }
        Some(ApprovalChoice::Reject) => {
            store.remember_reject(scope.clone());
            ApprovalStatus::Rejected
        }
        None => ApprovalStatus::Pending,
    }
}

/// Reject feedback for the model: a short note explaining the denial so the
/// agent can adjust (mirrors frontend reject feedback strings).
pub fn reject_feedback(tool_name: &str, reason: Option<&str>) -> String {
    match reason {
        Some(r) if !r.is_empty() => format!("User rejected the {tool_name} call: {r}"),
        _ => format!("User rejected the {tool_name} call. Adjust your approach or ask for clarification."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(s: &str) -> ApprovalScope {
        ApprovalScope(s.to_string())
    }

    #[test]
    fn once_approves_without_memory() {
        let mut store = ApprovalStore::default();
        assert_eq!(
            decide(&mut store, &scope("write_file"), Some(ApprovalChoice::Once)),
            ApprovalStatus::Approved
        );
        assert!(!store.auto_approved(&scope("write_file")));
    }

    #[test]
    fn always_cascades() {
        let mut store = ApprovalStore::default();
        assert_eq!(
            decide(&mut store, &scope("bash_run"), Some(ApprovalChoice::Always)),
            ApprovalStatus::Approved
        );
        // No user choice — auto-approved from memory.
        assert_eq!(decide(&mut store, &scope("bash_run"), None), ApprovalStatus::Approved);
    }

    #[test]
    fn reject_memorized_and_feedback() {
        let mut store = ApprovalStore::default();
        assert_eq!(
            decide(&mut store, &scope("edit"), Some(ApprovalChoice::Reject)),
            ApprovalStatus::Rejected
        );
        assert_eq!(decide(&mut store, &scope("edit"), None), ApprovalStatus::Rejected);
        assert_eq!(reject_feedback("edit", None), "User rejected the edit call. Adjust your approach or ask for clarification.");
        assert_eq!(reject_feedback("edit", Some("wrong file")), "User rejected the edit call: wrong file");
    }

    #[test]
    fn fresh_reject_overrides_stale_always() {
        let mut store = ApprovalStore::default();
        decide(&mut store, &scope("x"), Some(ApprovalChoice::Always));
        assert_eq!(decide(&mut store, &scope("x"), Some(ApprovalChoice::Reject)), ApprovalStatus::Rejected);
        // Memory now remembers reject.
        assert!(!store.auto_approved(&scope("x")));
    }

    #[test]
    fn pending_when_no_choice_and_no_memory() {
        let mut store = ApprovalStore::default();
        assert_eq!(decide(&mut store, &scope("y"), None), ApprovalStatus::Pending);
    }
}

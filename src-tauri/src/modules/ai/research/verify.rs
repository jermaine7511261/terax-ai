//! Evidence verification core (P3): exact-ID completeness + verdict
//! reconciliation. Each candidate claim has an id; the verifier must produce
//! one verdict per id, using each id exactly once (grok deep_research
//! exact-ID 完整性校验). `supported` only when the verifier marked it true.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub id: String,
    pub claim: String,
    pub evidence: String,
    pub source_title: String,
    pub source_locator: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifyReport {
    pub verified: Vec<Claim>,
    pub rejected: Vec<Claim>,
    pub missing_ids: Vec<String>,
    pub duplicate_ids: Vec<String>,
    /// Every candidate id got exactly one verdict.
    pub complete: bool,
}

/// Reconcile verdicts against candidate claims. `verdicts` is a list of
/// `{claim_id, supported, reason?}` objects. Mirrors the frontend's
/// `supportedIds` set but ALSO surfaces exact-ID completeness so the harness
/// can reject partial/duplicate verdict sets.
pub fn reconcile(candidates: &[Claim], verdicts: &[Value]) -> VerifyReport {
    use std::collections::{HashMap, HashSet};

    let mut supported: HashSet<String> = HashSet::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for v in verdicts {
        let Some(id) = v.get("claim_id").and_then(Value::as_str) else {
            continue;
        };
        if v.get("supported").and_then(Value::as_bool) == Some(true) {
            supported.insert(id.to_string());
        }
        *seen.entry(id.to_string()).or_insert(0) += 1;
    }

    let ids: HashSet<&str> = candidates.iter().map(|c| c.id.as_str()).collect();
    let mut missing: Vec<String> = ids
        .iter()
        .filter(|id| !seen.contains_key(**id))
        .map(|s| s.to_string())
        .collect();
    missing.sort();
    let mut duplicates: Vec<String> = seen
        .iter()
        .filter(|(_, n)| **n > 1)
        .map(|(id, _)| id.clone())
        .collect();
    duplicates.sort();

    let mut verified = Vec::new();
    let mut rejected = Vec::new();
    for c in candidates {
        if supported.contains(&c.id) {
            verified.push(c.clone());
        } else {
            rejected.push(c.clone());
        }
    }

    VerifyReport {
        complete: missing.is_empty() && duplicates.is_empty(),
        verified,
        rejected,
        missing_ids: missing,
        duplicate_ids: duplicates,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn claim(id: &str) -> Claim {
        Claim {
            id: id.to_string(),
            claim: format!("claim {id}"),
            evidence: format!("ev {id}"),
            source_title: format!("src {id}"),
            source_locator: format!("https://example.com/{id}"),
        }
    }

    #[test]
    fn complete_reconciliation() {
        let candidates = vec![claim("c1"), claim("c2")];
        let verdicts = vec![
            json!({"claim_id": "c1", "supported": true}),
            json!({"claim_id": "c2", "supported": false}),
        ];
        let r = reconcile(&candidates, &verdicts);
        assert!(r.complete);
        assert_eq!(r.verified.len(), 1);
        assert_eq!(r.verified[0].id, "c1");
        assert_eq!(r.rejected.len(), 1);
        assert_eq!(r.rejected[0].id, "c2");
        assert!(r.missing_ids.is_empty());
        assert!(r.duplicate_ids.is_empty());
    }

    #[test]
    fn missing_and_duplicate_ids_flagged() {
        let candidates = vec![claim("c1"), claim("c2"), claim("c3")];
        let verdicts = vec![
            json!({"claim_id": "c1", "supported": true}),
            json!({"claim_id": "c1", "supported": true}), // duplicate
            // c2, c3 missing
        ];
        let r = reconcile(&candidates, &verdicts);
        assert!(!r.complete);
        assert_eq!(r.duplicate_ids, vec!["c1".to_string()]);
        assert_eq!(r.missing_ids, vec!["c2".to_string(), "c3".to_string()]);
        // Verified set still contains c1 (dup does not double it).
        assert_eq!(r.verified.len(), 1);
    }

    #[test]
    fn unsupported_verdict_rejects() {
        let candidates = vec![claim("c1")];
        let verdicts = vec![json!({"claim_id": "c1", "supported": false})];
        let r = reconcile(&candidates, &verdicts);
        assert!(r.complete);
        assert!(r.verified.is_empty());
        assert_eq!(r.rejected.len(), 1);
    }

    #[test]
    fn malformed_verdicts_ignored() {
        let candidates = vec![claim("c1")];
        let verdicts = vec![json!({"foo": "bar"})];
        let r = reconcile(&candidates, &verdicts);
        assert!(!r.complete);
        assert_eq!(r.missing_ids, vec!["c1".to_string()]);
        assert!(r.verified.is_empty());
    }
}

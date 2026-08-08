//! Token estimation (P0). Cheap bytes/4 estimate matching the frontend
//! `compact.ts`/`agent.ts` convention, plus fixed costs for images and a
//! thinking budget. Exact mode (tiktoken-rs) is a later-phase option; the
//! harness only ever needs an approximation for the context gate.

/// Approximate tokens for a UTF-8 string: bytes/4, same convention the
/// frontend compaction uses (`approxBytes(messages) / 4`).
pub fn estimate_tokens(text: &str) -> u64 {
    text.len() as u64 / 4
}

/// Fixed cost per image part (frontend counts images at 2000; the harness
/// rounds the common case down so the gate stays conservative about large
/// images, matching cch tokenEstimation).
pub const IMAGE_TOKENS: u64 = 2000;

/// Reasoning output is billed like output tokens; models that emit a large
/// reasoning block are counted via the same bytes/4 path, so no extra knob is
/// needed here — kept as a constant for the caller's reporting only.
pub const THINKING_BILLING: bool = true;

/// Estimate tokens for a JSON value (tool-call inputs, tool results) the same
/// way the frontend does: JSON.stringify(...).length / 4.
pub fn estimate_json_tokens(value: &serde_json::Value) -> u64 {
    let bytes = serde_json::to_vec(value).unwrap_or_default().len();
    bytes as u64 / 4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_per_four_is_the_estimate() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcdefgh"), 2);
        assert_eq!(estimate_tokens("hello world"), 2); // 11 bytes / 4
    }

    #[test]
    fn utf8_bytes_not_chars() {
        // Each CJK char is 3 bytes in UTF-8.
        assert_eq!(estimate_tokens("中文"), 1); // 6 bytes / 4
    }

    #[test]
    fn json_estimate_counts_serialized_bytes() {
        let v = serde_json::json!({"a": "bcd"});
        assert!(estimate_json_tokens(&v) >= 1);
        assert_eq!(estimate_json_tokens(&serde_json::Value::Null), 1); // "null" = 4 bytes
    }

    #[test]
    fn image_cost_is_fixed() {
        assert_eq!(IMAGE_TOKENS, 2000);
    }
}

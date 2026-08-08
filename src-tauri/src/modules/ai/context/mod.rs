//! Context system (P0: token estimation; select/compact/prune pure core in P1).

pub mod compact;
pub mod token;

use serde::Serialize;

/// Estimate the token cost of a text chunk for the context-usage indicator.
#[tauri::command]
pub fn ai_estimate_tokens(text: String) -> u64 {
    token::estimate_tokens(&text)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEstimate {
    pub text: u64,
}

/// Batch token estimate for a message list (string contents only; parts
/// arrays fall back to per-part estimation via the JSON path).
#[tauri::command]
pub fn ai_estimate_messages(messages: Vec<serde_json::Value>) -> Result<TokenEstimate, String> {
    let mut total = 0u64;
    for m in messages {
        let content = m.get("content").ok_or_else(|| "missing content".to_string())?;
        match content {
            serde_json::Value::String(s) => total += token::estimate_tokens(s),
            serde_json::Value::Array(parts) => {
                for part in parts {
                    match part.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                total += token::estimate_tokens(t);
                            } else {
                                total += 64;
                            }
                        }
                        Some("image") => total += token::IMAGE_TOKENS,
                        Some("tool-result") | Some("tool-call") => {
                            total += token::estimate_json_tokens(part)
                        }
                        _ => total += 64,
                    }
                }
            }
            _ => total += 64,
        }
    }
    Ok(TokenEstimate { text: total })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_messages_sums_string_contents() {
        let msgs = vec![
            serde_json::json!({"role": "user", "content": "abcd"}),
            serde_json::json!({"role": "assistant", "content": "efgh"}),
        ];
        let out = ai_estimate_messages(msgs).unwrap();
        assert_eq!(out.text, 2);
    }

    #[test]
    fn estimate_messages_counts_image_parts_fixed() {
        let msgs = vec![serde_json::json!({
            "role": "user",
            "content": [
                {"type": "text", "text": "abcd"},
                {"type": "image", "image": "data:image/png;base64,...."},
            ]
        })];
        let out = ai_estimate_messages(msgs).unwrap();
        assert_eq!(out.text, token::estimate_tokens("abcd") + token::IMAGE_TOKENS);
    }

    #[test]
    fn estimate_messages_rejects_missing_content() {
        assert!(ai_estimate_messages(vec![serde_json::json!({"role": "user"})]).is_err());
    }
}

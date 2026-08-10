//! Parallel web-search provider (MCP `tools/call`). POSTs a JSON-RPC
//! `web_search` tool call to the Parallel MCP endpoint. Always considered
//! configured: it acts as an always-on fallback, sending the API key as a
//! `Authorization: Bearer` header only when one is present (anonymous
//! degradation otherwise). Maps `result.content[].text` via `mcp_parse`.

use async_trait::async_trait;
use serde_json::{json, Value};

use super::ddg::SearchHit;
use super::mcp_parse::parse_mcp_response;
use super::provider::{FailureCategory, SearchError, SearchProvider, SearchRequest};

const PARALLEL_MCP_ENDPOINT: &str = "https://parallel.that.ai/mcp";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// Parallel provider. Always considered configured (acts as a fallback).
pub struct ParallelProvider {
    key: Option<String>,
}

impl ParallelProvider {
    pub fn new(key: Option<String>) -> Self {
        Self { key }
    }
}

#[async_trait]
impl SearchProvider for ParallelProvider {
    fn name(&self) -> &'static str {
        "parallel"
    }

    fn is_configured(&self) -> bool {
        true
    }

    async fn search(&self, request: &SearchRequest) -> Result<Vec<SearchHit>, SearchError> {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "web_search",
                "arguments": {
                    "objective": request.query.as_str(),
                    "search_queries": [request.query.as_str()],
                    "session_id": "yamet",
                    "model_name": "gpt-5"
                }
            }
        });

        let (parsed, client) = crate::modules::net::safe_client_for_url(PARALLEL_MCP_ENDPOINT, false)
            .await
            .map_err(|e| SearchError::new(e, FailureCategory::Network))?;
        let mut builder = client
            .post(parsed)
            .header("user-agent", USER_AGENT)
            .json(&body);
        // Key (if any) rides the Authorization header; without it the request
        // goes out anonymous (degraded).
        let has_key = self.key.is_some();
        if let Some(key) = &self.key {
            builder = builder.header("authorization", format!("Bearer {key}"));
        }
        let resp = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            builder.send(),
        )
        .await
        .map_err(|_| SearchError::new("parallel request timed out", FailureCategory::Timeout))?
        .map_err(|e| {
            SearchError::new(
                format!("parallel request failed: {e}"),
                FailureCategory::Network,
            )
        })?;

        let status = resp.status().as_u16();
        if status >= 400 {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .map(|s| s.min(2));
            let degraded = status == 429 || ((401..=403).contains(&status) && !has_key);
            return Err(SearchError {
                message: format!("parallel http {status}"),
                category: if status == 429 {
                    FailureCategory::RateLimited
                } else {
                    FailureCategory::Network
                },
                degraded,
                retry_after,
            });
        }

        let bytes = tokio::time::timeout(std::time::Duration::from_secs(30), resp.bytes())
            .await
            .map_err(|_| SearchError::new("parallel body read timed out", FailureCategory::Timeout))?
            .map_err(|e| {
                SearchError::new(
                    format!("parallel body read failed: {e}"),
                    FailureCategory::Network,
                )
            })?;

        let texts = parse_mcp_response(&bytes).map_err(|e| SearchError {
            message: format!("parallel parse error: {e}"),
            category: FailureCategory::Parse,
            degraded: true,
            retry_after: None,
        })?;

        let mut hits: Vec<SearchHit> = Vec::new();
        for text in &texts {
            if hits.len() >= request.max_results {
                break;
            }
            hits.extend(text_to_hits(text));
        }
        hits.truncate(request.max_results);
        Ok(hits)
    }
}

/// Map one MCP result-text blob into [`SearchHit`]s.
///
/// - If the text is JSON with an array (or a `results` array), take each
///   item's `title`/`url`/`snippet` (with `link`/`text`/`description`
///   fallbacks).
/// - Otherwise treat the whole text as a snippet and pull the first `http(s)`
///   link as the url (title left empty).
pub fn text_to_hits(text: &str) -> Vec<SearchHit> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        let items: Vec<&Value> = if let Some(arr) = value.as_array() {
            arr.iter().collect()
        } else if let Some(arr) = value.get("results").and_then(|r| r.as_array()) {
            arr.iter().collect()
        } else {
            Vec::new()
        };
        if !items.is_empty() {
            let mut hits = Vec::new();
            for (i, item) in items.iter().enumerate() {
                let title = item
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let url = item
                    .get("url")
                    .and_then(|v| v.as_str())
                    .or_else(|| item.get("link").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let snippet = item
                    .get("snippet")
                    .and_then(|v| v.as_str())
                    .or_else(|| item.get("text").and_then(|v| v.as_str()))
                    .or_else(|| item.get("description").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                if !url.is_empty() || !title.is_empty() {
                    hits.push(SearchHit {
                        title,
                        url,
                        snippet,
                        position: Some(i + 1),
                    });
                }
            }
            if !hits.is_empty() {
                return hits;
            }
        }
    }
    // Not a JSON result array → treat the whole text as the snippet.
    if !trimmed.is_empty() {
        return vec![SearchHit {
            title: String::new(),
            url: extract_first_url(trimmed),
            snippet: trimmed.to_string(),
            position: Some(1),
        }];
    }
    Vec::new()
}

/// Return the first `http(s)://` substring (up to a delimiter) in `s`, or an
/// empty string if none.
fn extract_first_url(s: &str) -> String {
    let mut best: Option<(usize, usize)> = None;
    for prefix in ["https://", "http://"] {
        if let Some(idx) = s.find(prefix) {
            let mut end = idx + prefix.len();
            for ch in s[end..].chars() {
                if ch.is_whitespace() || matches!(ch, '"' | '<' | '>' | ',' | ')' | ']' | '\'') {
                    break;
                }
                end += ch.len_utf8();
            }
            let len = end - idx;
            if best.is_none_or(|(_, b)| len > b) {
                best = Some((idx, len));
            }
        }
    }
    match best {
        Some((idx, len)) => s[idx..idx + len].to_string(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_json_results_array() {
        let text = r#"[
            {"title": "A", "url": "https://a.dev", "snippet": "snippet a"},
            {"title": "B", "url": "https://b.dev", "snippet": "snippet b"}
        ]"#;
        let hits = text_to_hits(text);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "A");
        assert_eq!(hits[0].url, "https://a.dev");
        assert_eq!(hits[0].snippet, "snippet a");
        assert_eq!(hits[0].position, Some(1));
        assert_eq!(hits[1].position, Some(2));
    }

    #[test]
    fn maps_results_object_with_fallback_fields() {
        let text = r#"{"results": [{"name": "Y", "link": "https://y.dev", "description": "d"}]}"#;
        let hits = text_to_hits(text);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://y.dev");
        assert_eq!(hits[0].snippet, "d");
    }

    #[test]
    fn falls_back_to_snippet_and_first_url() {
        let text = "Check https://parallel.dev/docs for details";
        let hits = text_to_hits(text);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://parallel.dev/docs");
        assert_eq!(hits[0].snippet, text);
    }

    #[test]
    fn empty_text_yields_empty() {
        assert!(text_to_hits("").is_empty());
    }
}

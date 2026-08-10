//! Exa web-search provider (key'd, MCP `tools/call`). POSTs a JSON-RPC
//! `web_search` tool call to the Exa MCP endpoint with the API key in the URL
//! query, then maps the `result.content[].text` blobs (via `mcp_parse`) into
//! [`SearchHit`]s. Rides the SSRF-safe client like `ddg`.

use async_trait::async_trait;
use serde_json::{json, Value};
use url::Url;

use super::ddg::SearchHit;
use super::mcp_parse::parse_mcp_response;
use super::provider::{FailureCategory, SearchError, SearchProvider, SearchRequest};

const EXA_MCP_ENDPOINT: &str = "https://api.exa.ai/mcp";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/// Exa provider. Configured only when a key is present.
pub struct ExaProvider {
    key: Option<String>,
}

impl ExaProvider {
    pub fn new(key: Option<String>) -> Self {
        Self { key }
    }
}

#[async_trait]
impl SearchProvider for ExaProvider {
    fn name(&self) -> &'static str {
        "exa"
    }

    fn is_configured(&self) -> bool {
        self.key.is_some()
    }

    async fn search(&self, request: &SearchRequest) -> Result<Vec<SearchHit>, SearchError> {
        let key = self.key.clone().ok_or_else(|| {
            SearchError::new("exa provider requires an api key", FailureCategory::Auth)
        })?;

        // Key rides the URL query (Exa's contract), url-encoded by the parser.
        let mut url = Url::parse(EXA_MCP_ENDPOINT).map_err(|e| {
            SearchError::new(
                format!("invalid exa endpoint: {e}"),
                FailureCategory::Internal,
            )
        })?;
        url.query_pairs_mut().append_pair("exaApiKey", &key);

        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "web_search",
                "arguments": {
                    "query": request.query.as_str(),
                    "type": "neural",
                    "numResults": request.max_results
                }
            }
        });

        let (parsed, client) = crate::modules::net::safe_client_for_url(url.as_str(), false)
            .await
            .map_err(|e| SearchError::new(e, FailureCategory::Network))?;
        let resp = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            client
                .post(parsed)
                .header("user-agent", USER_AGENT)
                .json(&body)
                .send(),
        )
        .await
        .map_err(|_| SearchError::new("exa request timed out", FailureCategory::Timeout))?
        .map_err(|e| {
            SearchError::new(
                format!("exa request failed: {e}"),
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
            return Err(SearchError {
                message: format!("exa http {status}"),
                category: if status == 429 {
                    FailureCategory::RateLimited
                } else {
                    FailureCategory::Network
                },
                degraded: status == 429,
                retry_after,
            });
        }

        let bytes = tokio::time::timeout(std::time::Duration::from_secs(30), resp.bytes())
            .await
            .map_err(|_| SearchError::new("exa body read timed out", FailureCategory::Timeout))?
            .map_err(|e| {
                SearchError::new(
                    format!("exa body read failed: {e}"),
                    FailureCategory::Network,
                )
            })?;

        let texts = parse_mcp_response(&bytes).map_err(|e| SearchError {
            message: format!("exa parse error: {e}"),
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
            {"title": "Rust Book", "url": "https://doc.rust-lang.org/book", "snippet": "Learn Rust"},
            {"title": "Example", "url": "https://example.com", "snippet": "A plain site"}
        ]"#;
        let hits = text_to_hits(text);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Rust Book");
        assert_eq!(hits[0].url, "https://doc.rust-lang.org/book");
        assert_eq!(hits[0].snippet, "Learn Rust");
        assert_eq!(hits[0].position, Some(1));
        assert_eq!(hits[1].position, Some(2));
    }

    #[test]
    fn maps_results_object_with_fallback_fields() {
        let text = r#"{"results": [{"name": "X", "link": "https://x.dev", "description": "desc"}]}"#;
        let hits = text_to_hits(text);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://x.dev");
        assert_eq!(hits[0].snippet, "desc");
    }

    #[test]
    fn falls_back_to_snippet_and_first_url() {
        let text = "See https://example.com/guide and more at http://foo.test";
        let hits = text_to_hits(text);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://example.com/guide");
        assert_eq!(hits[0].snippet, text);
        assert!(hits[0].title.is_empty());
    }

    #[test]
    fn empty_text_yields_empty() {
        assert!(text_to_hits("").is_empty());
        assert!(text_to_hits("   ").is_empty());
    }
}

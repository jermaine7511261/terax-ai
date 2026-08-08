//! DuckDuckGo HTML search provider (P1.5). Free, no-key. Rides the SSRF-safe
//! reqwest client via `net::safe_client_for_url` and parses the HTML search
//! results page.

use async_trait::async_trait;
use serde::Serialize;
use url::Url;

use super::provider::{FailureCategory, SearchError, SearchProvider, SearchRequest};

const DDG_HTML_ENDPOINT: &str = "https://html.duckduckgo.com/html/";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<usize>,
}

pub struct DdgProvider;

impl Default for DdgProvider {
    fn default() -> Self {
        Self
    }
}

#[async_trait]
impl SearchProvider for DdgProvider {
    fn name(&self) -> &'static str {
        "duckduckgo"
    }

    fn is_configured(&self) -> bool {
        true
    }

    async fn search(&self, request: &SearchRequest) -> Result<Vec<SearchHit>, SearchError> {
        let mut url = Url::parse(DDG_HTML_ENDPOINT)
            .map_err(|e| SearchError::new(format!("invalid ddg endpoint: {e}"), FailureCategory::Internal))?;
        url.query_pairs_mut().append_pair("q", &request.query);
        fetch_ddg(url.as_str(), request.max_results).await
    }
}

/// Fetch + parse DDG HTML results. Extracted as a separate async fn so the
/// SSRF client is the only network dependency and tests can target the parser.
pub async fn fetch_ddg(url: &str, max_results: usize) -> Result<Vec<SearchHit>, SearchError> {
    let (parsed, client) = crate::modules::net::safe_client_for_url(url, false)
        .await
        .map_err(|e| SearchError::new(e, FailureCategory::Network))?;
    let resp = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        client
            .get(parsed)
            .header("user-agent", USER_AGENT)
            .send(),
    )
    .await
    .map_err(|_| SearchError::new("ddg request timed out", FailureCategory::Timeout))?
    .map_err(|e| SearchError::new(format!("ddg request failed: {e}"), FailureCategory::Network))?;

    let status = resp.status().as_u16();
    if status >= 400 {
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .map(|s| s.min(2));
        return Err(SearchError {
            message: format!("ddg http {status}"),
            category: crate::modules::net::web_search::provider::FailureCategory::RateLimited,
            degraded: status == 429,
            retry_after,
        });
    }
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(30), resp.bytes())
        .await
        .map_err(|_| SearchError::new("ddg body read timed out", FailureCategory::Timeout))?
        .map_err(|e| SearchError::new(format!("ddg body read failed: {e}"), FailureCategory::Network))?;
    let html = String::from_utf8_lossy(&bytes).to_string();

    // Fake-success detection (P1-1): 200 + no results but a challenge/anomaly
    // page is NOT an empty result set — surface it as a typed error.
    let parsed = parse_ddg(&html, max_results);
    if parsed.is_empty() {
        if let Some(err) = detect_fake_success(&html) {
            return Err(err);
        }
    }
    Ok(parsed)
}

/// Detect a DDG anomaly / captcha shell served with HTTP 200. Returns a typed
/// `RateLimited` / `Captcha`-classified error, or `None` when the page is a
/// genuine empty-result set. (P1-1; mirrors search-cli `scrape_rejection`.)
fn detect_fake_success(html: &str) -> Option<SearchError> {
    let head = &html[..html.len().min(4000)];
    let head_lower = head.to_ascii_lowercase();
    let mojibake_ratio = head
        .chars()
        .filter(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        .count() as f64
        / head.len().max(1) as f64;
    let challenge = ["anomaly", "captcha", "just a moment", "cf-challenge", "challenge-platform"]
        .iter()
        .any(|k| head_lower.contains(k));
    if challenge {
        return Some(SearchError {
            message: "search blocked by ddg challenge/captcha".into(),
            category: crate::modules::net::web_search::provider::FailureCategory::RateLimited,
            degraded: true,
            retry_after: None,
        });
    }
    if mojibake_ratio > 0.05 {
        return Some(SearchError {
            message: "search returned unreadable (mojibake) content".into(),
            category: crate::modules::net::web_search::provider::FailureCategory::Parse,
            degraded: true,
            retry_after: None,
        });
    }
    None
}

/// Parse DDG HTML search results. Pure — unit-tested against real HTML
/// fixtures. Handles:
/// - `class="result__body"` block splitting (tolerant)
/// - `class="result__a"` title + href (with `uddg` tracking unwrap)
/// - `class="result__snippet"` snippet
/// - a regex fallback over the whole page
pub fn parse_ddg(html: &str, max_results: usize) -> Vec<SearchHit> {
    let mut hits: Vec<SearchHit> = Vec::new();
    for block in html.split("class=\"result__body\"") {
        if hits.len() >= max_results {
            break;
        }
        if !block.contains("result__a") {
            continue;
        }
        let title = capture(block, r#"class="result__a"[^>]*>(.*?)</a>"#)
            .map(|s| strip_tags(&s))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let href = capture(block, r#"class="result__a"[^>]*href="([^"]+)""#)
            .map(|s| resolve_search_url(&s))
            .unwrap_or_default();
        let snippet = capture(block, r#"class="result__snippet"[^>]*>(.*?)</a>"#)
            .map(|s| strip_tags(&s))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if !title.is_empty() && !href.is_empty() {
            hits.push(SearchHit {
                title,
                url: href,
                snippet,
                position: Some(hits.len() + 1),
            });
        }
    }
    if hits.is_empty() {
        // Fallback: regex over the whole HTML.
        let re = regex::Regex::new(r#"<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>"#)
            .expect("static regex");
        for (i, caps) in re.captures_iter(html).enumerate() {
            if hits.len() >= max_results {
                break;
            }
            hits.push(SearchHit {
                title: strip_tags(&caps[2]).trim().to_string(),
                url: resolve_search_url(&caps[1]),
                snippet: String::new(),
                position: Some(i + 1),
            });
        }
    }
    hits
}

fn capture(input: &str, pattern: &str) -> Option<String> {
    let re = regex::Regex::new(pattern).ok()?;
    let caps = re.captures(input)?;
    caps.get(1).map(|m| m.as_str().to_string())
}

/// Unwrap DDG's protocol-relative `uddg` tracking redirect to the real URL.
/// Falls back to the raw href for direct links. (P0-1 fix.)
fn resolve_search_url(raw_href: &str) -> String {
    let href = decode_entities(raw_href);
    // Protocol-relative links have no scheme; give the parser one so the
    // `uddg` query can be read (DDG wraps results in a tracking redirect).
    let candidate = match href.strip_prefix("//") {
        Some(rest) => format!("https://{rest}"),
        None => href.clone(),
    };
    if let Ok(url) = Url::parse(&candidate) {
        if let Some(uddg) = url
            .query_pairs()
            .find(|(k, _)| k == "uddg")
            .map(|(_, v)| v.into_owned())
        {
            if uddg.starts_with("https://") || uddg.starts_with("http://") {
                return uddg;
            }
        }
    }
    // Not a tracking link: normalize to a real scheme when it was
    // protocol-relative (some DDG variants emit `//example.com` directly).
    href.strip_prefix("//")
        .map(|h| format!("https://{h}"))
        .unwrap_or(href)
}

fn strip_tags(s: &str) -> String {
    // Remove any HTML tags (regex is fine for this tolerant path).
    let re = regex::Regex::new(r"<[^>]*>").expect("static regex");
    decode_entities(&re.replace_all(s, ""))
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
<html><body>
  <div class="result__body">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdoc.rust-lang.org%2Fbook&amp;rut=abc">The Rust Book</a>
    <a class="result__snippet" href="...">Learn Rust with examples.</a>
  </div>
  <div class="result__body">
    <a class="result__a" href="https://example.com/guide">Example Guide</a>
    <a class="result__snippet" href="...">A plain link.</a>
  </div>
</body></html>
"#;

    #[test]
    fn parses_result_blocks() {
        let hits = parse_ddg(FIXTURE, 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "The Rust Book");
        assert_eq!(hits[0].url, "https://doc.rust-lang.org/book");
        assert_eq!(hits[0].snippet, "Learn Rust with examples.");
        assert_eq!(hits[1].url, "https://example.com/guide");
        assert_eq!(hits[1].position, Some(2));
    }

    #[test]
    fn unwraps_uddg_tracking_link() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fdoc.rust-lang.org%2Fbook&rut=abc";
        assert_eq!(resolve_search_url(href), "https://doc.rust-lang.org/book");
    }

    #[test]
    fn leaves_direct_link_untouched() {
        assert_eq!(resolve_search_url("https://example.com/guide"), "https://example.com/guide");
    }

    #[test]
    fn protocol_relative_direct_link_becomes_https() {
        assert_eq!(resolve_search_url("//example.com/guide"), "https://example.com/guide");
    }

    #[test]
    fn respects_max_results() {
        let hits = parse_ddg(FIXTURE, 1);
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn empty_html_yields_empty() {
        assert!(parse_ddg("<html><body></body></html>", 10).is_empty());
    }

    #[test]
    fn snippet_tags_stripped_and_entities_decoded() {
        let html = r#"<div class="result__body">
          <a class="result__a" href="https://x.com/a">A &amp; B</a>
          <a class="result__snippet" href="...">Fast &amp; reliable <b>code</b></a>
        </div>"#;
        let hits = parse_ddg(html, 10);
        assert_eq!(hits[0].title, "A & B");
        assert_eq!(hits[0].snippet, "Fast & reliable code");
    }

    #[test]
    fn fake_success_detects_challenge_shell() {
        let html = "<html><body>Anomaly Detected — DDG challenge page with captcha tokens</body></html>";
        assert!(detect_fake_success(html).is_some());
    }

    #[test]
    fn fake_success_none_for_genuine_empty() {
        let html = "<html><body>No results found for your query.</body></html>";
        assert!(detect_fake_success(html).is_none());
    }

    #[test]
    fn fake_success_none_for_normal_page() {
        let html = "<html><body>regular results page with ordinary text content</body></html>";
        assert!(detect_fake_success(html).is_none());
    }

    #[test]
    fn fallback_regex_covers_whole_page() {
        let html = r#"<html><body>snippet <a class="result__a" href="https://a.example/x">Title</a> tail</body></html>"#;
        let hits = parse_ddg(html, 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Title");
        assert_eq!(hits[0].url, "https://a.example/x");
    }
}

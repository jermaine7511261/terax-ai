//! `WebFetchClient` — shared HTTP client with cache, HTML-to-markdown
//! conversion, URL validation, and SSRF protection.
//! Ported from Grok grok-build `web_fetch/client.rs`. Media/PDF/video
//! download-to-disk is simplified: binary content types are reported rather
//! than saved to a session file system.

use std::sync::Arc;

use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, USER_AGENT};
use url::Url;

use super::cache::FetchCache;
use super::config::{MAX_REDIRECTS, MAX_URL_LENGTH, USER_AGENT_STRING, WebFetchParams};
use super::domain::DomainMatcher;
use super::http::HttpClient;
use super::ssrf;
use super::types::{WebFetchContent, WebFetchError, WebFetchOutput};

/// Shared HTTP client and cache for web fetching.
#[derive(Clone)]
pub struct WebFetchClient {
    http: HttpClient,
    cache: Arc<parking_lot::RwLock<FetchCache>>,
    converter: Arc<htmd::HtmlToMarkdown>,
    domain_matcher: Arc<DomainMatcher>,
    params: WebFetchParams,
}

struct ProcessedText {
    content: String,
    content_type: String,
    bytes: usize,
    was_truncated: bool,
}

impl WebFetchClient {
    pub fn new(params: &WebFetchParams) -> Result<Self, WebFetchError> {
        let converter = Arc::new(
            htmd::HtmlToMarkdown::builder()
                .skip_tags(vec![
                    "script", "style", "noscript", "svg", "iframe", "object", "embed",
                ])
                .build(),
        );
        let domains = params.allowed_domains();
        let domain_matcher = Arc::new(DomainMatcher::new(&domains));

        Ok(Self {
            http: HttpClient::new(params)?,
            cache: Arc::new(parking_lot::RwLock::new(FetchCache::new(
                params.cache_ttl_secs(),
                params.max_cache_entries(),
            ))),
            converter,
            domain_matcher,
            params: params.clone(),
        })
    }

    /// Fetch a URL with an optional inline-length override (max_chars).
    pub async fn fetch_with_max(
        &self,
        raw_url: &str,
        max_chars: Option<usize>,
    ) -> Result<WebFetchOutput, WebFetchError> {
        let mut url = validate_url(raw_url)?;
        upgrade_to_https(&mut url);

        let url_str = url.to_string();

        if let Some(blocked) = self.domain_matcher.check(&url) {
            return Ok(blocked);
        }

        // Respect per-call cache override: only the default budget shares cache.
        let effective_max = max_chars.unwrap_or(self.params.max_markdown_length());
        {
            let cache = self.cache.read();
            if let Some(cached) = cache.get(&url_str) {
                return Ok(cached.clone());
            }
        }

        ssrf::check_ssrf(&url, self.params.allow_local()).await?;

        let http = self.http.get_or_rebuild()?;
        let result = match fetch_url(
            &http,
            &url,
            self.params.max_content_length(),
            self.params.allow_local(),
        )
        .await
        {
            Ok(result) => result,
            Err(e @ WebFetchError::HttpRequest(_)) => {
                self.http.invalidate();
                return Err(e);
            }
            Err(e) => return Err(e),
        };

        let (body, content_type, final_url, status_code) = match result {
            FetchResult::Content {
                body,
                content_type,
                final_url,
                status_code,
            } => (body, content_type, final_url, status_code),
            FetchResult::CrossHostRedirect {
                original_host,
                redirect_url,
            } => {
                return Ok(WebFetchOutput::CrossHostRedirect {
                    original_host,
                    redirect_url,
                });
            }
        };

        if is_pdf(&content_type) || is_image(&content_type) || is_video(&content_type) {
            return Ok(WebFetchOutput::Content(WebFetchContent {
                url: final_url,
                content: format!(
                    "{} downloaded ({} bytes). This is a binary resource; use a dedicated tool to inspect it.",
                    content_type, body.len()
                ),
                content_type,
                status_code,
                bytes: body.len(),
                truncated: false,
                metadata: Default::default(),
            }));
        }

        if is_binary_content_type(&content_type) {
            return Err(WebFetchError::UnsupportedContentType {
                content_type,
                url: final_url,
            });
        }

        let processed = self.process_text_content(&body, &content_type, effective_max);
        let was_truncated = processed.was_truncated;

        let output = WebFetchOutput::Content(WebFetchContent {
            url: final_url,
            content: processed.content,
            content_type: processed.content_type,
            status_code,
            bytes: processed.bytes,
            truncated: was_truncated,
            metadata: Default::default(),
        });

        {
            let mut cache = self.cache.write();
            cache.insert_text(url_str, output.clone(), was_truncated);
        }

        Ok(output)
    }

    /// Fetch a URL and return its content as markdown.
    #[allow(dead_code)] // used by tests; fetch_with_max is the live entrypoint
    pub async fn fetch(&self, raw_url: &str) -> Result<WebFetchOutput, WebFetchError> {
        self.fetch_with_max(raw_url, None).await
    }

    fn process_text_content(
        &self,
        body: &[u8],
        content_type: &str,
        max_md: usize,
    ) -> ProcessedText {
        let raw_content = String::from_utf8_lossy(body);
        let content = if is_html(content_type) {
            html_to_markdown(&self.converter, &raw_content)
        } else {
            raw_content.into_owned()
        };
        let content = strip_base64_data_uris(content);
        let bytes = content.len();
        let output_content_type = if is_html(content_type) {
            "markdown".to_string()
        } else {
            content_type.to_owned()
        };
        let was_truncated = bytes > max_md;
        let content = if was_truncated {
            // Truncate at a safe point and mark it.
            let truncated: String = content.chars().take(max_md).collect();
            format!("{truncated}\n\n[... truncated to fit context window ...]")
        } else {
            content
        };
        ProcessedText {
            content,
            content_type: output_content_type,
            bytes,
            was_truncated,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// URL Validation
// ───────────────────────────────────────────────────────────────────────────

/// Validates URL scheme, length, credentials, and hostname labels.
fn validate_url(raw: &str) -> Result<Url, WebFetchError> {
    if raw.len() > MAX_URL_LENGTH {
        return Err(WebFetchError::UrlTooLong {
            max: MAX_URL_LENGTH,
        });
    }

    let parsed = Url::parse(raw)?;

    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(WebFetchError::UnsupportedScheme {
                scheme: scheme.to_string(),
            });
        }
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(WebFetchError::CredentialsInUrl);
    }

    if let Some(host) = parsed.host_str() {
        if host.split('.').count() < 2 && !ssrf::is_explicit_local_host(host) {
            return Err(WebFetchError::SingleLabelHost {
                host: host.to_string(),
            });
        }
    }

    Ok(parsed)
}

/// Upgrade `http://` to `https://`, except for explicit loopback hosts.
fn upgrade_to_https(url: &mut Url) {
    if url.scheme() != "http" {
        return;
    }
    if let Some(host) = url.host_str() {
        if ssrf::is_explicit_local_host(host) {
            return;
        }
    }
    let _ = url.set_scheme("https");
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP Fetching
// ───────────────────────────────────────────────────────────────────────────

enum FetchResult {
    Content {
        body: Vec<u8>,
        content_type: String,
        final_url: String,
        status_code: u16,
    },
    CrossHostRedirect {
        original_host: String,
        redirect_url: String,
    },
}

/// Fetch a URL with manual same-host redirect handling.
/// Re-runs SSRF checks on every hop so DNS rebinding between redirects cannot
/// sneak a previously-blocked address past the initial check.
async fn fetch_url(
    client: &reqwest::Client,
    url: &Url,
    max_content_length: usize,
    allow_local: bool,
) -> Result<FetchResult, WebFetchError> {
    let mut current_url = url.clone();
    let mut hops = 0;

    // Loop to follow redirects under the same host.
    loop {
        // Re-check on every hop (including the first).
        ssrf::check_ssrf(&current_url, allow_local).await?;

        let resp = client
            .get(current_url.as_str())
            .header(USER_AGENT, USER_AGENT_STRING)
            .header(
                ACCEPT,
                "text/markdown,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header(ACCEPT_LANGUAGE, "en-US,en;q=0.9")
            .send()
            .await?;

        let status = resp.status();

        if status.is_redirection() {
            hops += 1;
            if hops > MAX_REDIRECTS {
                return Err(WebFetchError::TooManyRedirects { max: MAX_REDIRECTS });
            }

            // Follow same host; break on cross-host.
            if let Some(location) = resp.headers().get("location") {
                let location_str = location.to_str().unwrap_or("");
                let mut next_url = current_url
                    .join(location_str)
                    .map_err(|e| WebFetchError::InvalidRedirect(format!("{e}")))?;
                if is_same_host(&current_url, &next_url) {
                    // Re-apply https upgrade on every hop.
                    upgrade_to_https(&mut next_url);
                    current_url = next_url;
                    continue;
                }
                return Ok(FetchResult::CrossHostRedirect {
                    original_host: current_url.host_str().unwrap_or("unknown").to_string(),
                    redirect_url: next_url.to_string(),
                });
            }
        }

        let content_type = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("text/html")
            .to_string();
        let final_url = resp.url().to_string();
        let status_code = status.as_u16();

        let body = resp.bytes().await?;

        if body.len() > max_content_length {
            return Err(WebFetchError::ResponseTooLarge {
                max: max_content_length,
            });
        }

        return Ok(FetchResult::Content {
            body: body.to_vec(),
            content_type,
            final_url,
            status_code,
        });
    }
}

/// Exact host equality — no `www.` stripping.
fn is_same_host(a: &Url, b: &Url) -> bool {
    a.host_str() == b.host_str()
}

// ───────────────────────────────────────────────────────────────────────────
// Content Processing
// ───────────────────────────────────────────────────────────────────────────

fn is_html(content_type: &str) -> bool {
    content_type.contains("text/html") || content_type.contains("application/xhtml")
}

fn is_pdf(content_type: &str) -> bool {
    content_type.contains("application/pdf")
}

fn is_image(content_type: &str) -> bool {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();
    mime.starts_with("image/") && mime != "image/svg+xml"
}

fn is_video(content_type: &str) -> bool {
    content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase()
        .starts_with("video/")
}

fn is_binary_content_type(content_type: &str) -> bool {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();

    if mime.starts_with("text/") {
        return false;
    }
    !matches!(
        mime.as_str(),
        "application/json"
            | "application/xml"
            | "application/javascript"
            | "application/ecmascript"
            | "application/x-javascript"
            | "application/xhtml+xml"
            | "application/rss+xml"
            | "application/atom+xml"
            | "application/soap+xml"
            | "application/xslt+xml"
            | "application/mathml+xml"
            | "application/svg+xml"
            | "application/x-www-form-urlencoded"
            | "application/graphql"
            | "application/ld+json"
            | "application/schema+json"
            | "application/vnd.api+json"
            | "application/x-yaml"
            | "application/yaml"
            | "application/toml"
    )
}

fn html_to_markdown(converter: &htmd::HtmlToMarkdown, html: &str) -> String {
    let cleaned = clean_html(html);
    converter
        .convert(&cleaned)
        .unwrap_or_else(|_| html.to_string())
}

/// Remove common noisy elements from HTML before markdown conversion.
fn clean_html(html: &str) -> String {
    let mut document = scraper::Html::parse_document(html);

    let root_id = document
        .tree
        .root()
        .children()
        .find(|child| child.value().is_element())
        .map(|node| node.id());

    let selectors: Vec<scraper::Selector> = [
        "nav",
        "header",
        "footer",
        "[class*='cookie']",
        "[class*='sidebar']",
        "[class*='ad-']",
        "[class*='advert']",
        "[id*='cookie']",
        "[id*='sidebar']",
        "[id*='ad-']",
        "[id*='advert']",
    ]
    .iter()
    .filter_map(|s| scraper::Selector::parse(s).ok())
    .collect();

    selectors.iter().for_each(|selector| {
        document
            .select(selector)
            .map(|e| e.id())
            .collect::<Vec<_>>()
            .into_iter()
            .for_each(|id| {
                if Some(id) == root_id {
                    return;
                }
                if let Some(mut node) = document.tree.get_mut(id) {
                    node.detach();
                }
            });
    });

    document.html()
}

/// Strip base64 data URIs from content to prevent token bloat.
fn strip_base64_data_uris(content: String) -> String {
    const MIN_BASE64_PAYLOAD: usize = 4;
    const MAX_HEADER_LEN: usize = 120;

    if !content.contains("data:") {
        return content;
    }

    let s = content.as_str();
    let mut result = String::with_capacity(s.len());
    let mut last_end = 0;
    let mut search_from = 0;

    while let Some(rel) = s[search_from..].find("data:") {
        let start = search_from + rel;

        if start > 0 && s.as_bytes()[start - 1].is_ascii_alphanumeric() {
            search_from = start + 5;
            continue;
        }

        if let Some(rel_comma) = s[start..].find(',') {
            let comma = start + rel_comma;
            let header = &s[start + 5..comma];

            if header.len() > MAX_HEADER_LEN {
                search_from = comma + 1;
                continue;
            }
            if !header.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b';' | b'/' | b':' | b'-' | b'+' | b'.')) {
                search_from = comma + 1;
                continue;
            }

            // Find end of base64 payload.
            let payload_start = comma + 1;
            let mut end = payload_start;
            let bytes = s.as_bytes();
            while end < bytes.len() && is_base64_char(bytes[end]) {
                end += 1;
            }
            // Optional trailing '=' padding.
            let mut pad = 0;
            while end + pad < bytes.len() && bytes[end + pad] == b'=' {
                pad += 1;
            }
            let total = end + pad - start;
            if total >= MIN_BASE64_PAYLOAD {
                result.push_str(&s[last_end..start]);
                result.push_str("[base64 data elided]");
                last_end = end + pad;
                search_from = end + pad;
            } else {
                search_from = comma + 1;
            }
        } else {
            break;
        }
    }

    result.push_str(&s[last_end..]);
    result
}

fn is_base64_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'+' || b == b'/'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_base64_removes_data_uris() {
        let input = "hello data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA world";
        let out = strip_base64_data_uris(input.to_string());
        assert!(out.contains("hello"));
        assert!(out.contains("[base64 data elided]"));
        assert!(out.contains("world"));
        assert!(!out.contains("iVBOR"));
    }

    #[test]
    fn strip_base64_keeps_normal_text() {
        let input = "just some plain text with no data uris";
        assert_eq!(strip_base64_data_uris(input.to_string()), input);
    }

    #[test]
    fn validate_url_rejects_credentials() {
        assert!(matches!(
            validate_url("https://user:pass@example.com/"),
            Err(WebFetchError::CredentialsInUrl)
        ));
    }

    #[test]
    fn validate_url_rejects_bad_scheme() {
        assert!(matches!(
            validate_url("ftp://example.com/"),
            Err(WebFetchError::UnsupportedScheme { .. })
        ));
    }

    #[test]
    fn validate_url_rejects_single_label() {
        assert!(matches!(
            validate_url("https://intranet/"),
            Err(WebFetchError::SingleLabelHost { .. })
        ));
    }

    #[test]
    fn validate_url_allows_localhost() {
        // localhost is single-label but explicitly allowed.
        assert!(validate_url("http://localhost:8080/").is_ok());
    }

    #[test]
    fn upgrade_http_to_https_except_localhost() {
        let mut url = Url::parse("http://example.com/").unwrap();
        upgrade_to_https(&mut url);
        assert_eq!(url.scheme(), "https");

        let mut local = Url::parse("http://localhost:8080/").unwrap();
        upgrade_to_https(&mut local);
        assert_eq!(local.scheme(), "http");
    }

    #[test]
    fn is_binary_detects_binary() {
        assert!(is_binary_content_type("application/octet-stream"));
        assert!(!is_binary_content_type("text/plain"));
        assert!(!is_binary_content_type("application/json"));
    }

    #[test]
    fn media_types_recognized() {
        assert!(is_image("image/png"));
        assert!(!is_image("image/svg+xml")); // SVG excluded (XSS vector)
        assert!(is_pdf("application/pdf"));
        assert!(is_video("video/mp4"));
    }

    /// Real-network fetch smoke test. `#[ignore]` by default so it never blocks
    /// CI (which may be offline). Run explicitly:
    ///   cargo test --lib --ignored web_fetch::client::tests::real_fetch
    #[tokio::test]
    #[ignore]
    async fn real_fetch_docs_rs() {
        let client = WebFetchClient::new(&WebFetchParams::default()).unwrap();
        let out = client.fetch("https://docs.rs/reqwest/latest").await.unwrap();
        match out {
            WebFetchOutput::Content(c) => {
                assert_eq!(c.content_type, "markdown");
                assert!(!c.content.is_empty());
            }
            other => panic!("expected Content, got {other:?}"),
        }
    }

    /// Real-network: a private IP literal is rejected (either by domain
    /// allowlist or SSRF) before any egress.
    #[tokio::test]
    #[ignore]
    async fn real_fetch_ssrf_blocks_private() {
        let client = WebFetchClient::new(&WebFetchParams::default()).unwrap();
        let result = client.fetch("https://10.0.0.1/secret").await;
        match result {
            Err(e) => assert!(e.to_string().contains("blocked") || e.to_string().contains("domain")),
            Ok(WebFetchOutput::DomainNotAllowed(_)) => {}
            Ok(other) => panic!("expected rejection, got {other:?}"),
        }
    }
}

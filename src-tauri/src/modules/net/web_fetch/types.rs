//! yamet web_fetch — ported from  -build `web_fetch` tool.
//!
//! Fetches a URL with SSRF protection, domain allowlist, HTTPS upgrade,
//! HTML→markdown conversion, caching, and content-type dispatch. The 
//! implementation has been adapted to yamet's types (plain structs + String
//! errors instead of xai_tool_runtime::ToolError, no session-file system).

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

// ───────────────────────────────────────────────────────────────────────────
// Output (mirrors  WebFetchOutput, but plain + serde)
// ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchContent {
    /// The final URL (may differ from input after redirects).
    pub url: String,
    /// Page content converted to markdown (or raw text for non-HTML).
    pub content: String,
    /// Content type: "markdown" for converted HTML, or the original MIME type.
    pub content_type: String,
    /// HTTP status code.
    pub status_code: u16,
    /// Size of the content in bytes (before truncation).
    pub bytes: usize,
    /// Whether the inline content was truncated to fit the budget.
    pub truncated: bool,
    /// Extra metadata (redirects followed, content type subtype).
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WebFetchOutput {
    Content(WebFetchContent),
    /// Domain is not in the allowed domains list.
    DomainNotAllowed(String),
    /// Server redirected to a different host.
    CrossHostRedirect {
        original_host: String,
        redirect_url: String,
    },
    /// Pre-formatted error message.
    Error { url: Option<String>, message: String },
}

impl WebFetchOutput {
    /// Render to a prompt-friendly string (mirrors  to_prompt_format).
    pub fn to_prompt_format(&self) -> String {
        match self {
            Self::Content(c) => c.content.clone(),
            Self::DomainNotAllowed(domain) => {
                format!("Error: domain {} is not in the allowed domains list", domain)
            }
            Self::CrossHostRedirect {
                original_host,
                redirect_url,
            } => format!(
                "Error: cross-host redirect from {} to {}. Make a new web_fetch call with the redirect URL if needed.",
                original_host, redirect_url
            ),
            Self::Error {
                url: Some(url),
                message,
            } => format!("Error fetching URL {}: {}", url, message),
            Self::Error { url: None, message } => format!("Error: {}", message),
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Error
// ───────────────────────────────────────────────────────────────────────────

/// Mirrors 's `WebFetchError` (16 variants) mapped to a flat enum.
#[derive(Debug, Clone)]
pub enum WebFetchError {
    UnsupportedScheme { scheme: String },
    CredentialsInUrl,
    /// A sensitive query parameter (api_key / token / secret / ...) with a
    /// non-empty value was found in the URL — reject whole-URL (decision 6).
    SecretInUrl { param: String },
    SingleLabelHost { host: String },
    InvalidUrl(String),
    UrlTooLong { max: usize },
    SsrfBlocked { host: String, ip: std::net::IpAddr },
    DnsResolution { host: String },
    DnsEmpty(String),
    ClientBuildError(String),
    HttpRequest(String),
    InvalidRedirect(String),
    TooManyRedirects { max: usize },
    ResponseTooLarge { max: usize },
    ProxyConfigError(String),
    IoError(String),
    UnsupportedContentType { content_type: String, url: String },
    ContentTypeMismatch { content_type: String, url: String },
}

impl fmt::Display for WebFetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedScheme { scheme } => {
                write!(f, "unsupported URL scheme: {scheme} (only http/https)")
            }
            Self::CredentialsInUrl => write!(f, "URL must not contain credentials"),
            Self::SecretInUrl { param } => write!(
                f,
                "URL contains a sensitive query parameter '{param}' with a value — refusing to fetch (would leak a secret)"
            ),
            Self::SingleLabelHost { host } => {
                write!(f, "single-label hostname not allowed: {host}")
            }
            Self::InvalidUrl(e) => write!(f, "invalid URL: {e}"),
            Self::UrlTooLong { max } => write!(f, "URL exceeds {max} characters"),
            Self::SsrfBlocked { host, ip } => {
                // 's smart hint: for github hosts with `gh` available, suggest gh CLI.
                let mut msg = format!("blocked by SSRF policy: {host} resolves to private/local address {ip}");
                if host.to_lowercase().contains("github") {
                    msg.push_str(
                        " (hint: use the `gh` CLI to fetch GitHub data instead)",
                    );
                }
                write!(f, "{msg}")
            }
            Self::DnsResolution { host } => write!(f, "DNS resolution failed for {host}"),
            Self::DnsEmpty(h) => write!(f, "DNS returned no addresses for {h}"),
            Self::ClientBuildError(e) => write!(f, "failed to build HTTP client: {e}"),
            Self::HttpRequest(e) => write!(f, "HTTP request failed: {e}"),
            Self::InvalidRedirect(e) => write!(f, "invalid redirect: {e}"),
            Self::TooManyRedirects { max } => write!(f, "too many redirects (max {max})"),
            Self::ResponseTooLarge { max } => write!(f, "response exceeds {max} bytes"),
            Self::ProxyConfigError(e) => write!(f, "invalid proxy config: {e}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::UnsupportedContentType { content_type, url } => {
                write!(f, "unsupported content type {content_type} for {url}")
            }
            Self::ContentTypeMismatch { content_type, url } => {
                write!(f, "content type {content_type} did not match body magic bytes for {url}")
            }
        }
    }
}

impl std::error::Error for WebFetchError {}

impl From<url::ParseError> for WebFetchError {
    fn from(e: url::ParseError) -> Self {
        Self::InvalidUrl(e.to_string())
    }
}

impl From<reqwest::Error> for WebFetchError {
    fn from(e: reqwest::Error) -> Self {
        Self::HttpRequest(e.to_string())
    }
}

//! Multi-provider search abstraction (P1.5). DDG is the built-in free
//! provider; key'd sources (Exa / Brave / Parallel via MCP `tools/call`) slot
//! in behind the same trait later. Mirrors search-cli's `Provider` trait +
//! registry shape.

use async_trait::async_trait;

use super::ddg::SearchHit;

/// Typed failure category (search-cli `FailureCategory`): lets callers
/// distinguish auth/quota/rate-limit from transient network noise instead of
/// swallowing everything as "no results".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureCategory {
    Auth,
    Quota,
    RateLimited,
    Timeout,
    Network,
    Server,
    Parse,
    Internal,
}

#[derive(Debug, Clone)]
pub struct SearchError {
    pub message: String,
    pub category: FailureCategory,
    /// True when the provider degraded into a lower-quality path (challenge
    /// shell, mojibake, partial failover). Callers surface `degraded` instead
    /// of silently reporting zero results.
    pub degraded: bool,
    pub retry_after: Option<u64>,
}

impl SearchError {
    pub fn new(message: impl Into<String>, category: FailureCategory) -> Self {
        Self {
            message: message.into(),
            category,
            degraded: false,
            retry_after: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SearchRequest {
    pub query: String,
    pub max_results: usize,
    pub categories: Vec<String>,
}

#[async_trait]
pub trait SearchProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_configured(&self) -> bool;
    async fn search(&self, request: &SearchRequest) -> Result<Vec<SearchHit>, SearchError>;
}

/// Registry of known providers with their default enablement. Future key'd
/// providers register here and are selected by `is_configured`; DDG is always
/// available (no key needed).
pub const PROVIDER_MODES: &[(&str, &str)] = &[("duckduckgo", "free"), ("exa", "key"), ("brave", "key"), ("parallel", "key")];

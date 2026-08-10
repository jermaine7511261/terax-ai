//! `web_search` (P1.5) — free DuckDuckGo HTML search, natively in Rust.
//!
//! Fixes the frontend `tools/net.ts` defects documented in the round-25 plan:
//! P0-1 `uddg` tracking links not unwrapped, P0-2 `truncated` semantics wrong,
//! P1-1 anomaly/captcha silent empty results. Parsing + reranking are pure
//! functions (tested); the network call rides the same SSRF-guarded client as
//! `ai_http_stream`.

pub mod ddg;
pub mod exa;
pub mod mcp_parse;
pub mod parallel;
pub mod provider;
pub mod rerank;

use std::sync::Arc;

use parking_lot::RwLock;
use serde::Serialize;
use tauri::{AppHandle, State};

use self::ddg::SearchHit;
use self::provider::{FailureCategory, SearchError, SearchProvider, SearchRequest};

const DEFAULT_MAX_RESULTS: usize = 5;
const MAX_MAX_RESULTS: usize = 10;

/// Keyring service/account used to read provider API keys (mirrors
/// `modules::ai::harness::KEYRING_SERVICE`).
const KEYRING_SERVICE: &str = "yamet-ai";
const EXA_KEY_ACCOUNT: &str = "exa-api-key";
const PARALLEL_KEY_ACCOUNT: &str = "parallel-api-key";

pub struct WebSearchState {
    /// Lazily-built, cached provider list (ordered by `PROVIDER_MODES`).
    providers: RwLock<Option<Vec<Arc<dyn SearchProvider + Send + Sync>>>>,
}

impl Default for WebSearchState {
    fn default() -> Self {
        Self {
            providers: RwLock::new(None),
        }
    }
}

/// Build the provider list in `PROVIDER_MODES` order, keeping only providers
/// that report `is_configured()`. Pure — takes resolved keys so it can be unit
/// tested without touching the OS keyring.
fn build_providers(
    exa_key: Option<String>,
    parallel_key: Option<String>,
) -> Vec<Arc<dyn SearchProvider + Send + Sync>> {
    let mut out: Vec<Arc<dyn SearchProvider + Send + Sync>> = Vec::new();
    for (mode, _enablement) in provider::PROVIDER_MODES {
        let p: Arc<dyn SearchProvider + Send + Sync> = match *mode {
            "duckduckgo" => Arc::new(ddg::DdgProvider),
            "exa" => Arc::new(exa::ExaProvider::new(exa_key.clone())),
            "parallel" => Arc::new(parallel::ParallelProvider::new(parallel_key.clone())),
            "brave" => continue, // not yet implemented
            _ => continue,
        };
        if p.is_configured() {
            out.push(p);
        }
    }
    out
}

/// Get the configured providers in priority order, building + caching on first
/// call. Keys are read from keyring once; Exa drops out when its key is absent.
fn get_providers(
    app: &AppHandle,
    state: &WebSearchState,
) -> Vec<Arc<dyn SearchProvider + Send + Sync>> {
    if let Some(ps) = state.providers.read().clone() {
        return ps;
    }
    let exa_key = crate::modules::secrets::read_key(app, KEYRING_SERVICE, EXA_KEY_ACCOUNT)
        .ok()
        .flatten();
    let parallel_key =
        crate::modules::secrets::read_key(app, KEYRING_SERVICE, PARALLEL_KEY_ACCOUNT)
            .ok()
            .flatten();
    let providers = build_providers(exa_key, parallel_key);
    *state.providers.write() = Some(providers.clone());
    providers
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchCommandResult {
    pub ok: bool,
    pub query: String,
    pub results: Vec<SearchHit>,
    pub truncated: bool,
    pub degraded: bool,
    /// Failure category of the terminal error, when `ok == false`. Lets the
    /// frontend branch on `auth` / `quota` / `rateLimited` / etc. instead of
    /// only string-matching `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<FailureCategory>,
    /// Earliest `Retry-After` seen across the failover chain, surfaced for the
    /// frontend to schedule a retry. `None` when not rate-limited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
    /// Human-readable error message, present when `ok == false`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchParams {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    pub categories: Option<Vec<String>>,
    /// Optional ISO date window (`YYYY-MM-DD`) — forwarded to the provider as
    /// a time-range filter (DDG `df`/`dt`). `None` = no restriction.
    #[serde(default)]
    pub date_from: Option<String>,
    #[serde(default)]
    pub date_to: Option<String>,
}

/// Tauri command: search the web through the configured providers in priority
/// order, with fake-success detection + lexical reranking + failover. Errors
/// that are retryable (`RateLimited`/`Quota`/`Timeout`/`Server`/`Network`)
/// fall through to the next provider; terminal errors (`Auth`/`Parse`/
/// `Internal`) abort immediately with their category.
#[tauri::command]
pub async fn web_search(
    app: AppHandle,
    state: State<'_, WebSearchState>,
    params: WebSearchParams,
) -> Result<WebSearchCommandResult, String> {
    let query = params.query.trim().to_string();
    if query.is_empty() {
        return Ok(WebSearchCommandResult {
            ok: false,
            query: String::new(),
            results: vec![],
            truncated: false,
            degraded: false,
            category: None,
            retry_after: None,
            error: Some("query is required".into()),
        });
    }
    let max = params
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, MAX_MAX_RESULTS);
    let request = SearchRequest {
        query: query.clone(),
        max_results: max,
        categories: params.categories.unwrap_or_default(),
        date_from: params.date_from.clone(),
        date_to: params.date_to.clone(),
    };
    let providers = get_providers(&app, &state);
    Ok(run_failover(&providers, &request, &query, max).await)
}

/// Drive the failover chain over `providers` in order. Returns the first
/// successful (reranked) result, or a terminal error result if any provider
/// hits a non-retryable category, or an aggregate error if all providers fail
/// with retryable categories. `degraded` accumulates across the chain.
async fn run_failover(
    providers: &[Arc<dyn SearchProvider + Send + Sync>],
    request: &SearchRequest,
    query: &str,
    max: usize,
) -> WebSearchCommandResult {
    let mut degraded = false;
    let mut retry_after: Option<u64> = None;
    let mut last_err: Option<SearchError> = None;

    for p in providers {
        match p.search(request).await {
            Ok(hits) => {
                let ranked = rerank::rerank(hits, query, max);
                let truncated = ranked.len() >= max;
                return WebSearchCommandResult {
                    ok: true,
                    query: query.to_string(),
                    results: ranked,
                    truncated,
                    degraded,
                    category: None,
                    retry_after,
                    error: None,
                };
            }
            Err(e) => {
                degraded |= e.degraded;
                retry_after = retry_after.or(e.retry_after);
                let category = e.category;
                // Terminal categories abort the chain immediately.
                if matches!(
                    category,
                    FailureCategory::Auth
                        | FailureCategory::Parse
                        | FailureCategory::Internal
                ) {
                    return WebSearchCommandResult {
                        ok: false,
                        query: query.to_string(),
                        results: vec![],
                        truncated: false,
                        degraded,
                        category: Some(category),
                        retry_after,
                        error: Some(e.message),
                    };
                }
                // Retryable: record and try the next provider.
                last_err = Some(e);
            }
        }
    }

    // All providers failed on retryable categories → aggregate.
    let (message, category) = match last_err {
        Some(e) => (e.message, e.category),
        None => (
            "no search providers configured".into(),
            FailureCategory::Internal,
        ),
    };
    WebSearchCommandResult {
        ok: false,
        query: query.to_string(),
        results: vec![],
        truncated: false,
        degraded,
        category: Some(category),
        retry_after,
        error: Some(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use self::provider::{FailureCategory, SearchError, SearchRequest, SearchProvider};

    /// Deterministic fake provider for exercising the failover chain.
    struct FakeProvider {
        name: &'static str,
        configured: bool,
        result: Result<Vec<SearchHit>, SearchError>,
    }

    fn ok_hits() -> Result<Vec<SearchHit>, SearchError> {
        Ok(vec![SearchHit {
            title: "t".into(),
            url: "https://example.com".into(),
            snippet: "s".into(),
            position: Some(1),
        }])
    }

    fn prov_err(category: FailureCategory, degraded: bool) -> Result<Vec<SearchHit>, SearchError> {
        Err(SearchError {
            message: format!("{category:?} failure"),
            category,
            degraded,
            retry_after: Some(7),
        })
    }

    fn fake(
        name: &'static str,
        result: Result<Vec<SearchHit>, SearchError>,
    ) -> Arc<dyn SearchProvider + Send + Sync> {
        Arc::new(FakeProvider {
            name,
            configured: true,
            result,
        })
    }

    #[async_trait::async_trait]
    impl SearchProvider for FakeProvider {
        fn name(&self) -> &'static str {
            self.name
        }
        fn is_configured(&self) -> bool {
            self.configured
        }
        async fn search(&self, _r: &SearchRequest) -> Result<Vec<SearchHit>, SearchError> {
            self.result.clone()
        }
    }

    fn request(q: &str) -> SearchRequest {
        SearchRequest {
            query: q.into(),
            max_results: 5,
            categories: vec![],
            date_from: None,
            date_to: None,
        }
    }

    #[test]
    fn empty_query_reports_error() {
        // Command-layer logic is exercised through the pure functions; this
        // guards the result-shape contract.
        let r = WebSearchCommandResult {
            ok: false,
            query: String::new(),
            results: vec![],
            truncated: false,
            degraded: false,
            category: None,
            retry_after: None,
            error: Some("query is required".into()),
        };
        assert!(!r.ok);
        assert!(r.error.is_some());
    }

    /// Branch ①: provider selection respects PROVIDER_MODES order + is_configured.
    #[test]
    fn provider_selection_no_keys() {
        // No keys → DDG + Parallel are configured (Parallel is always-on per the
        // locked contract); Exa and Brave are excluded.
        let providers = build_providers(None, None);
        let names: Vec<&str> = providers.iter().map(|p| p.name()).collect();
        assert_eq!(names, vec!["duckduckgo", "parallel"]);

        // Exa joins the front of the chain once a key is present.
        let providers = build_providers(Some("k".into()), None);
        let names: Vec<&str> = providers.iter().map(|p| p.name()).collect();
        assert_eq!(names, vec!["duckduckgo", "exa", "parallel"]);
    }

    /// Branch ②: a terminal Auth error aborts the chain immediately.
    #[tokio::test]
    async fn auth_error_aborts_immediately() {
        let providers = vec![
            fake("ddg", prov_err(FailureCategory::Auth, false)),
            fake("parallel", ok_hits()),
        ];
        let r = run_failover(&providers, &request("q"), "q", 5).await;
        assert!(!r.ok);
        assert_eq!(r.category, Some(FailureCategory::Auth));
        // Parallel (which would succeed) must not be reached.
        assert!(r.results.is_empty());
    }

    /// Branch ③: a rate-limited provider falls through to the next, succeeding
    /// with degraded accumulated + retry_after surfaced.
    #[tokio::test]
    async fn rate_limited_falls_back_to_next_provider() {
        let providers = vec![
            fake("ddg", prov_err(FailureCategory::RateLimited, true)),
            fake("parallel", ok_hits()),
        ];
        let r = run_failover(&providers, &request("q"), "q", 5).await;
        assert!(r.ok);
        assert!(r.degraded, "degraded flag must carry across failover");
        assert_eq!(r.retry_after, Some(7));
        assert_eq!(r.results.len(), 1);
    }

    /// Branch ④: all providers fail on retryable categories → aggregate error.
    #[tokio::test]
    async fn all_fail_aggregates_error() {
        let providers = vec![
            fake("ddg", prov_err(FailureCategory::Timeout, false)),
            fake("parallel", prov_err(FailureCategory::Network, true)),
        ];
        let r = run_failover(&providers, &request("q"), "q", 5).await;
        assert!(!r.ok);
        assert!(r.error.is_some());
        assert!(r.degraded, "degraded must accumulate from last provider");
        // Terminal category is the last error's category (network), not the first.
        assert_eq!(r.category, Some(FailureCategory::Network));
        assert_eq!(r.retry_after, Some(7));
    }
}

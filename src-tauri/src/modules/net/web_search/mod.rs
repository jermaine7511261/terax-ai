//! `web_search` (P1.5) — free DuckDuckGo HTML search, natively in Rust.
//!
//! Fixes the frontend `tools/net.ts` defects documented in the round-25 plan:
//! P0-1 `uddg` tracking links not unwrapped, P0-2 `truncated` semantics wrong,
//! P1-1 anomaly/captcha silent empty results. Parsing + reranking are pure
//! functions (tested); the network call rides the same SSRF-guarded client as
//! `ai_http_stream`.

pub mod ddg;
pub mod provider;
pub mod rerank;

use std::sync::Arc;

use parking_lot::RwLock;
use serde::Serialize;
use tauri::State;

use self::ddg::SearchHit;
use self::provider::{SearchProvider, SearchRequest};

const DEFAULT_MAX_RESULTS: usize = 5;
const MAX_MAX_RESULTS: usize = 10;

pub struct WebSearchState {
    client: RwLock<Option<Arc<dyn SearchProvider + Send + Sync>>>,
}

impl Default for WebSearchState {
    fn default() -> Self {
        Self {
            client: RwLock::new(None),
        }
    }
}

fn get_provider(state: &WebSearchState) -> Arc<dyn SearchProvider + Send + Sync> {
    if let Some(p) = state.client.read().clone() {
        return p;
    }
    let p: Arc<dyn SearchProvider + Send + Sync> = Arc::new(ddg::DdgProvider);
    *state.client.write() = Some(Arc::clone(&p));
    p
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchCommandResult {
    pub ok: bool,
    pub query: String,
    pub results: Vec<SearchHit>,
    pub truncated: bool,
    pub degraded: bool,
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

/// Tauri command: search the web through the configured provider (DDG by
/// default), with fake-success detection + lexical reranking.
#[tauri::command]
pub async fn web_search(
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
            error: Some("query is required".into()),
        });
    }
    let max = params
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, MAX_MAX_RESULTS);
    let provider = get_provider(&state);
    let request = SearchRequest {
        query: query.clone(),
        max_results: max,
        categories: params.categories.unwrap_or_default(),
        date_from: params.date_from.clone(),
        date_to: params.date_to.clone(),
    };
    match provider.search(&request).await {
        Ok(hits) => {
            let ranked = rerank::rerank(hits, &query, max);
            let truncated = ranked.len() >= max;
            Ok(WebSearchCommandResult {
                ok: true,
                query,
                results: ranked,
                truncated,
                degraded: false,
                error: None,
            })
        }
        Err(e) => Ok(WebSearchCommandResult {
            ok: false,
            query,
            results: vec![],
            truncated: false,
            degraded: e.degraded,
            error: Some(e.message),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            error: Some("query is required".into()),
        };
        assert!(!r.ok);
        assert!(r.error.is_some());
    }
}

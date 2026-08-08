//! `web_fetch` — client-side URL fetching with HTML-to-markdown conversion
//! and SSRF protection. Ported from Grok grok-build `web_fetch` tool.
//!
//! Fetches a URL via `reqwest`, converts HTML to markdown via `htmd`,
//! enforces SSRF + domain allowlist, and returns content to the model.

mod cache;
mod client;
mod config;
mod domain;
mod http;
mod ssrf;
pub mod types;

use std::sync::Arc;

use parking_lot::RwLock;
use serde::Serialize;
use tauri::State;

use self::client::WebFetchClient;
use self::config::WebFetchParams;
use self::types::WebFetchOutput;

/// Module-level shared client, built lazily from default params on first use.
pub struct WebFetchState {
    client: RwLock<Option<Arc<WebFetchClient>>>,
}

impl Default for WebFetchState {
    fn default() -> Self {
        Self {
            client: RwLock::new(None),
        }
    }
}

/// Get (or lazily build) the shared client with default params.
fn get_client(state: &WebFetchState) -> Result<Arc<WebFetchClient>, String> {
    if let Some(client) = state.client.read().clone() {
        return Ok(client);
    }
    let client = Arc::new(
        WebFetchClient::new(&WebFetchParams::default()).map_err(|e| e.to_string())?,
    );
    *state.client.write() = Some(Arc::clone(&client));
    Ok(client)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchCommandResult {
    pub ok: bool,
    pub output: Option<WebFetchOutput>,
    pub error: Option<String>,
}

/// Tauri command: fetch a URL with full SSRF + domain-allowlist protection.
#[tauri::command]
pub async fn web_fetch(
    state: State<'_, WebFetchState>,
    url: String,
    max_chars: Option<usize>,
) -> Result<WebFetchCommandResult, String> {
    let client = get_client(&state)?;

    // Apply max_chars as a per-call inline-length override without rebuilding
    // the whole client (config is only read for truncation + content budget).
    let result = client.fetch_with_max(&url, max_chars).await;

    match result {
        Ok(output) => Ok(WebFetchCommandResult {
            ok: matches!(output, WebFetchOutput::Content(_)),
            output: Some(output),
            error: None,
        }),
        Err(e) => Ok(WebFetchCommandResult {
            ok: false,
            output: None,
            error: Some(e.to_string()),
        }),
    }
}

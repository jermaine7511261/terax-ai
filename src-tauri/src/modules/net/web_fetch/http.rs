//! Cached HTTP client with atomic invalidation for `web_fetch`.
//! Ported from Grok grok-build `web_fetch/http.rs` (ArcSwap → std RwLock).

use std::sync::{Arc, RwLock};

use reqwest::Client;

use super::config::WebFetchParams;
use super::types::WebFetchError;

/// Cached, invalidatable HTTP client for web fetching.
///
/// - **Normal path:** `get_or_rebuild()` returns the cached client via a lock.
/// - **On transport error:** call `invalidate()` to drop the client. The next
///   `get_or_rebuild()` builds a fresh one with a clean connection pool
///   (prevents connection pool poisoning).
#[derive(Clone, Debug)]
pub(crate) struct HttpClient {
    inner: Arc<RwLock<Option<Arc<Client>>>>,
    params: WebFetchParams,
}

impl HttpClient {
    pub(crate) fn new(params: &WebFetchParams) -> Result<Self, WebFetchError> {
        let client = Self::build(params)?;
        Ok(Self {
            inner: Arc::new(RwLock::new(Some(Arc::new(client)))),
            params: params.clone(),
        })
    }

    /// Get the current client, rebuilding if it was invalidated.
    pub(crate) fn get_or_rebuild(&self) -> Result<Arc<Client>, WebFetchError> {
        if let Some(client) = self.inner.read().unwrap_or_else(|e| e.into_inner()).clone() {
            return Ok(client);
        }
        let fresh = Arc::new(Self::build(&self.params)?);
        *self.inner.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::clone(&fresh));
        Ok(fresh)
    }

    /// Atomically invalidate the cached client.
    pub(crate) fn invalidate(&self) {
        *self.inner.write().unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn build(params: &WebFetchParams) -> Result<Client, WebFetchError> {
        let mut builder = Client::builder()
            .timeout(params.timeout_secs())
            .connect_timeout(std::time::Duration::from_secs(10))
            // We manage redirects for SSRF.
            .redirect(reqwest::redirect::Policy::none())
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(std::time::Duration::from_secs(30))
            .tcp_nodelay(true)
            // Reduce size of incoming payloads.
            .gzip(true)
            .brotli(true)
            .deflate(true);

        // Route all traffic through the egress proxy when configured.
        if let Some(ref endpoint) = params.proxy_endpoint {
            let proxy = reqwest::Proxy::all(endpoint)
                .map_err(|e| WebFetchError::ProxyConfigError(e.to_string()))?;
            builder = builder.proxy(proxy);
        }

        builder.build().map_err(|e| WebFetchError::ClientBuildError(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_or_rebuild_returns_client() {
        let client = HttpClient::new(&WebFetchParams::default()).unwrap();
        assert!(client.get_or_rebuild().is_ok());
    }

    #[test]
    fn invalidate_forces_rebuild() {
        let client = HttpClient::new(&WebFetchParams::default()).unwrap();
        let first = client.get_or_rebuild().unwrap();
        let first_ptr = Arc::as_ptr(&first);

        client.invalidate();
        let second = client.get_or_rebuild().unwrap();
        assert_ne!(first_ptr, Arc::as_ptr(&second));
    }

    #[test]
    fn build_with_proxy_endpoint() {
        let params = WebFetchParams {
            proxy_endpoint: Some("https://proxy.corp.example.com".into()),
            ..Default::default()
        };
        assert!(HttpClient::new(&params).is_ok());
    }

    #[test]
    fn build_with_invalid_proxy_endpoint() {
        let params = WebFetchParams {
            proxy_endpoint: Some("not a valid url".into()),
            ..Default::default()
        };
        let err = HttpClient::new(&params).unwrap_err();
        assert!(err.to_string().contains("proxy"));
    }
}

//! In-memory cache for self-contained text fetches with TTL expiry and eviction.
//! Ported from  -build `web_fetch/cache.rs`.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use super::types::WebFetchOutput;

#[derive(Clone)]
struct CachedPage {
    output: WebFetchOutput,
    inserted: Instant,
}

pub(crate) struct FetchCache {
    entries: HashMap<String, CachedPage>,
    ttl: Duration,
    max_entries: usize,
}

impl FetchCache {
    pub(crate) fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            ttl,
            max_entries,
        }
    }

    pub(crate) fn get(&self, url: &str) -> Option<&WebFetchOutput> {
        self.entries.get(url).and_then(|entry| {
            if entry.inserted.elapsed() < self.ttl {
                Some(&entry.output)
            } else {
                None
            }
        })
    }

    /// Cache only inline text; truncated outputs must be materialized per call.
    pub(crate) fn insert_text(&mut self, url: String, output: WebFetchOutput, was_truncated: bool) {
        if was_truncated {
            return;
        }
        if self.entries.len() >= self.max_entries {
            // Evict oldest entry.
            let oldest_key = self
                .entries
                .iter()
                .max_by_key(|(_, v)| v.inserted.elapsed())
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest_key {
                self.entries.remove(&key);
            }
        }
        self.entries.insert(
            url,
            CachedPage {
                output,
                inserted: Instant::now(),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::net::web_fetch::types::WebFetchContent;

    fn output(content: &str) -> WebFetchOutput {
        WebFetchOutput::Content(WebFetchContent {
            url: "https://example.com/".to_string(),
            content: content.to_string(),
            content_type: "markdown".to_string(),
            status_code: 200,
            bytes: content.len(),
            truncated: false,
            metadata: Default::default(),
        })
    }

    #[test]
    fn truncated_output_is_never_cached() {
        let mut cache = FetchCache::new(Duration::from_secs(60), 10);
        let url = "https://example.com/";
        cache.insert_text(url.to_string(), output("artifact-path"), true);
        assert!(cache.get(url).is_none());

        cache.insert_text(url.to_string(), output("fully inline"), false);
        assert!(cache.get(url).is_some());
    }

    #[test]
    fn evicts_oldest_when_full() {
        let mut cache = FetchCache::new(Duration::from_secs(60), 2);
        cache.insert_text("a".to_string(), output("a"), false);
        cache.insert_text("b".to_string(), output("b"), false);
        cache.insert_text("c".to_string(), output("c"), false);
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_some());
        assert!(cache.get("c").is_some());
    }
}

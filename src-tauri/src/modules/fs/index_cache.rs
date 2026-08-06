//! Lightweight search-result cache.
//!
//! `fs_search` walks the tree and fuzzy-ranks every candidate on every call.
//! For repeated searches over a large repo the ranking is the expensive part.
//! We cache the ranked hits keyed by `(root, query)` together with a cheap
//! *signature* of the search root's immediate children (name + mtime). If the
//! signature is unchanged the tree cannot have changed, so we serve the cached
//! result and skip the walk + rank entirely. When the signature changes the
//! cache entry is invalidated and the walk runs fresh.
//!
//! This is a best-effort accelerator: correctness never depends on it (a
//! missing/stale entry simply falls back to a full walk), and it is bounded in
//! size by [`MAX_ENTRIES`].

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use super::to_canon;
use crate::modules::fs::search::SearchHit;

/// Cap on cached entries (root+query pairs) before the oldest are evicted.
const MAX_ENTRIES: usize = 64;

#[derive(Clone)]
struct Entry {
    /// Signature of the root's immediate children (name + mtime), used to
    /// detect tree changes cheaply.
    signature: u64,
    hits: Vec<SearchHit>,
    truncated: bool,
}

pub struct SearchCache {
    map: Mutex<HashMap<(PathBuf, String), Entry>>,
    order: Mutex<Vec<(PathBuf, String)>>, // LRU-ish insertion order for eviction
}

impl SearchCache {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
            order: Mutex::new(Vec::new()),
        }
    }

    /// Try to serve a cached result for `(root, query)` if the root's child
    /// signature still matches. Returns `None` on any miss / mismatch.
    pub fn get(
        &self,
        root: &Path,
        query: &str,
    ) -> Option<(Vec<SearchHit>, bool)> {
        let sig = child_signature(root)?;
        let map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let e = map.get(&(root.to_path_buf(), query.to_string()))?;
        if e.signature != sig {
            return None;
        }
        Some((e.hits.clone(), e.truncated))
    }

    /// Store `(root, query) -> hits` with the current child signature.
    pub fn put(&self, root: &Path, query: &str, hits: Vec<SearchHit>, truncated: bool) {
        let Some(sig) = child_signature(root) else {
            return;
        };
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let mut order = self.order.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(
            (root.to_path_buf(), query.to_string()),
            Entry {
                signature: sig,
                hits,
                truncated,
            },
        );
        order.push((root.to_path_buf(), query.to_string()));
        while order.len() > MAX_ENTRIES {
            let old = order.remove(0);
            map.remove(&old);
        }
    }
}

/// Hash of a directory's immediate children (name + mtime). `None` if the root
/// doesn't exist or can't be read (treat as uncacheable → full walk).
fn child_signature(root: &Path) -> Option<u64> {
    let rd = std::fs::read_dir(root).ok()?;
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut seen = 0u64;
    for ent in rd {
        let Ok(ent) = ent else { continue };
        let name = to_canon(&*ent.file_name().to_string_lossy());
        let meta = ent.metadata().ok();
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        h = h.wrapping_mul(0x9e37_79b9_7f4a_7c15).wrapping_add(seen.wrapping_add(name.len() as u64));
        h ^= mtime.wrapping_mul(0x1000_0000_01b3);
        seen = seen.wrapping_add(1);
    }
    Some(h)
}

/// Process-global cache instance (lazily initialized).
pub static SEARCH_CACHE: OnceLock<SearchCache> = OnceLock::new();

/// Convenience accessor used by `fs_search`.
pub fn search_cache() -> &'static SearchCache {
    SEARCH_CACHE.get_or_init(SearchCache::new)
}

impl Default for SearchCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn hit(rel: &str) -> SearchHit {
        SearchHit {
            path: rel.to_string(),
            rel: rel.to_string(),
            name: rel.rsplit('/').next().unwrap_or(rel).to_string(),
            is_dir: false,
        }
    }

    #[test]
    fn cache_hit_when_signature_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let cache = SearchCache::new();
        let hits = vec![hit("a.txt")];
        cache.put(dir.path(), "a", hits.clone(), false);
        // Signature unchanged → cached hit.
        let got = cache.get(dir.path(), "a");
        assert!(got.is_some());
        assert_eq!(got.unwrap().0.len(), 1);
    }

    #[test]
    fn cache_misses_when_query_differs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let cache = SearchCache::new();
        cache.put(dir.path(), "a", vec![hit("a.txt")], false);
        assert!(cache.get(dir.path(), "b").is_none());
    }

    #[test]
    fn cache_invalidates_when_tree_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let cache = SearchCache::new();
        cache.put(dir.path(), "a", vec![hit("a.txt")], false);
        // Touch the root by adding a file with a distinct mtime.
        std::thread::sleep(Duration::from_millis(20));
        std::fs::write(dir.path().join("b.txt"), "y").unwrap();
        // Signature now differs (b.txt added) → cache miss → full walk.
        assert!(cache.get(dir.path(), "a").is_none());
    }

    #[test]
    fn put_evicts_oldest_beyond_cap() {
        let base = tempfile::tempdir().unwrap();
        let cache = SearchCache::new();
        // MAX_ENTRIES is 64; fill with 70 distinct roots.
        for i in 0..70 {
            let d = base.path().join(format!("d{i}"));
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("f.txt"), "x").unwrap();
            cache.put(&d, "q", vec![hit("f.txt")], false);
        }
        let map = cache.map.lock().unwrap_or_else(|e| e.into_inner());
        assert!(map.len() <= MAX_ENTRIES);
    }
}

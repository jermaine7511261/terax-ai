//! Lexical reranking + dedup of search results (P1.5). Ported from us/crw
//! `crw-search/src/rerank.rs` semantics: `is_junk` (never leaked through
//! degradation) → `covers` (query-term coverage) → registrable-domain dedup →
//! graceful degradation that relaxes coverage but NEVER re-admits junk.
//!
//! Single-source results must NOT use RRF (redundant — only one ranking).

use std::collections::HashSet;

use super::ddg::SearchHit;

const MIN_COVERAGE: f64 = 0.5;
const JUNK_HOST_BLACKLIST: &[&str] = &[
    "facebook.com",
    "instagram.com",
    "pinterest.com",
    "tiktok.com",
    "reddit.com",
];

fn tokenize(s: &str) -> Vec<String> {
    s.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() > 1)
        .map(str::to_string)
        .collect()
}

fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default()
    .to_ascii_lowercase()
}

/// Last two labels of a host (naive eTLD+1: `a.b.example.co.uk` → `co.uk`).
fn registrable_domain(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() <= 2 {
        return host.to_string();
    }
    labels[labels.len() - 2..].join(".")
}

fn is_junk(hit: &SearchHit) -> bool {
    let host = host_of(&hit.url);
    let title_lower = hit.title.to_ascii_lowercase();
    if JUNK_HOST_BLACKLIST.iter().any(|h| host.ends_with(h)) {
        return true;
    }
    // Aggressive ad/spam title patterns.
    ["sponsored", "advertisement", "buy now", "free download"]
        .iter()
        .any(|p| title_lower.contains(p))
}

fn covers(hit: &SearchHit, query_tokens: &HashSet<String>) -> f64 {
    if query_tokens.is_empty() {
        return 1.0;
    }
    let title_tokens: HashSet<String> = tokenize(&hit.title).into_iter().collect();
    let covered = query_tokens.iter().filter(|t| title_tokens.contains(*t)).count();
    covered as f64 / query_tokens.len() as f64
}

/// Rerank + dedup. `degrade` is true for the graceful-degradation pass (drops
/// the coverage floor but still filters junk).
pub fn rerank(hits: Vec<SearchHit>, query: &str, max_results: usize) -> Vec<SearchHit> {
    rerank_with(hits, query, max_results, MIN_COVERAGE, false)
}

fn rerank_with(
    hits: Vec<SearchHit>,
    query: &str,
    max_results: usize,
    min_coverage: f64,
    _degrade: bool,
) -> Vec<SearchHit> {
    let query_tokens: HashSet<String> = tokenize(query).into_iter().collect();
    let mut seen_domains: HashSet<String> = HashSet::new();
    let mut out: Vec<SearchHit> = Vec::new();

    // Sort by coverage descending, then keep original order as tiebreak.
    let mut scored: Vec<(SearchHit, f64)> = hits
        .into_iter()
        .map(|h| {
            let c = covers(&h, &query_tokens);
            (h, c)
        })
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    for (hit, coverage) in scored {
        if out.len() >= max_results {
            break;
        }
        if is_junk(&hit) {
            continue; // junk never leaks through — even in degradation
        }
        if coverage < min_coverage {
            continue;
        }
        let domain = registrable_domain(&host_of(&hit.url));
        if !domain.is_empty() && !seen_domains.insert(domain) {
            continue; // dedup same registrable domain
        }
        out.push(hit);
    }
    out
}

/// Graceful degradation: relax the coverage floor (but never junk). Exposed
/// for when the strict pass returns too few results.
pub fn rerank_degraded(hits: Vec<SearchHit>, query: &str, max_results: usize) -> Vec<SearchHit> {
    // Drop the coverage requirement entirely; junk + dedup still enforced.
    let query_tokens: HashSet<String> = tokenize(query).into_iter().collect();
    let mut seen_domains: HashSet<String> = HashSet::new();
    let mut out: Vec<SearchHit> = Vec::new();
    for hit in hits {
        if out.len() >= max_results {
            break;
        }
        if is_junk(&hit) {
            continue;
        }
        let _ = covers(&hit, &query_tokens);
        let domain = registrable_domain(&host_of(&hit.url));
        if !domain.is_empty() && !seen_domains.insert(domain) {
            continue;
        }
        out.push(hit);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(url: &str, title: &str) -> SearchHit {
        SearchHit {
            title: title.to_string(),
            url: url.to_string(),
            snippet: String::new(),
            position: None,
        }
    }

    #[test]
    fn junk_never_leaks_through_degrade() {
        let hits = vec![
            hit("https://www.reddit.com/r/rust", "Rust on Reddit"),
            hit("https://example.com/rust-book", "The Rust Book — Learn Rust"),
        ];
        let strict = rerank(hits.clone(), "rust book", 10);
        let degraded = rerank_degraded(hits, "rust book", 10);
        assert!(strict.iter().all(|h| !host_of(&h.url).contains("reddit")));
        assert!(degraded.iter().all(|h| !host_of(&h.url).contains("reddit")));
    }

    #[test]
    fn coverage_ranks_relevant_higher() {
        let hits = vec![
            hit("https://unrelated.example/random", "random content"),
            hit("https://doc.example/rust-book", "The Rust Book"),
        ];
        let ranked = rerank(hits, "rust book", 10);
        assert!(ranked[0].url.contains("rust-book"));
    }

    #[test]
    fn dedups_same_registrable_domain() {
        let hits = vec![
            hit("https://example.com/a", "Rust Guide A"),
            hit("https://example.com/b", "Rust Guide B"),
            hit("https://other.net/rust", "Rust Elsewhere"),
        ];
        let ranked = rerank(hits, "rust guide", 10);
        let domains: Vec<String> = ranked.iter().map(|h| registrable_domain(&host_of(&h.url))).collect();
        assert_eq!(domains.len(), 2);
        assert!(domains.contains(&"example.com".to_string()));
        assert!(domains.contains(&"other.net".to_string()));
    }

    #[test]
    fn respects_max_results() {
        let hits = vec![
            hit("https://a.example/1", "Rust One"),
            hit("https://b.example/2", "Rust Two"),
            hit("https://c.example/3", "Rust Three"),
        ];
        assert_eq!(rerank(hits, "rust", 2).len(), 2);
    }

    #[test]
    fn empty_query_keeps_everything_non_junk() {
        let hits = vec![hit("https://a.example/x", "anything")];
        assert_eq!(rerank(hits, "", 10).len(), 1);
    }

    #[test]
    fn sponsored_title_is_junk() {
        assert!(is_junk(&hit("https://a.example/x", "Sponsored: buy now")));
        assert!(!is_junk(&hit("https://a.example/x", "The Rust Book")));
    }
}

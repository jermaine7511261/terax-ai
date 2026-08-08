//! Domain allowlist matching with precomputed host → path-prefix lookup.
//! Ported from Grok grok-build `web_fetch/domain.rs`.

use std::collections::HashMap;

use url::Url;

use super::types::WebFetchOutput;

/// Canonical form for domain comparison: trim whitespace, strip trailing
/// slashes and dots, remove `www.` prefix, and lowercase.
pub fn normalize_domain(raw: &str) -> String {
    let s = raw.trim().trim_end_matches('/').trim_end_matches('.');
    let s = s.strip_prefix("www.").unwrap_or(s);
    s.to_lowercase()
}

/// What a single host is allowed to serve.
#[derive(Debug, Clone)]
enum HostEntry {
    /// Any path on this host is allowed (host-only entry).
    AnyPath,
    /// Only paths matching one of these prefixes are allowed.
    PathPrefixes(Vec<String>),
}

/// Precomputed domain allowlist. Built once from the raw allowlist entries,
/// provides O(1) host lookup + small linear scan over path prefixes.
#[derive(Debug, Clone)]
pub struct DomainMatcher {
    entries: HashMap<String, HostEntry>,
}

impl DomainMatcher {
    /// Build from raw allowlist entries like `"docs.rs"`, `"vercel.com/docs"`.
    pub fn new(raw_entries: &[String]) -> Self {
        let mut entries: HashMap<String, HostEntry> = HashMap::new();

        for raw in raw_entries {
            let normalized = normalize_domain(raw);
            if normalized.is_empty() {
                continue;
            }

            // Split on first '/' to separate host from optional path.
            let (host, path) = match normalized.find('/') {
                Some(i) => (normalized[..i].to_owned(), Some(&normalized[i..])),
                None => (normalized, None),
            };

            match path {
                None => {
                    // Host-only → any path allowed.
                    entries.insert(host, HostEntry::AnyPath);
                }
                Some(raw_path) => {
                    // Don't downgrade AnyPath to PathPrefixes.
                    if matches!(entries.get(&host), Some(HostEntry::AnyPath)) {
                        continue;
                    }

                    // Normalize path: ensure leading '/', strip trailing '/'.
                    let prefix = raw_path.trim_end_matches('/');
                    let prefix = if prefix.is_empty() || prefix == "/" {
                        entries.insert(host, HostEntry::AnyPath);
                        continue;
                    } else if prefix.starts_with('/') {
                        prefix.to_owned()
                    } else {
                        format!("/{prefix}")
                    };

                    entries
                        .entry(host)
                        .and_modify(|e| {
                            if let HostEntry::PathPrefixes(v) = e {
                                if !v.contains(&prefix) {
                                    v.push(prefix.clone());
                                }
                            }
                        })
                        .or_insert_with(|| HostEntry::PathPrefixes(vec![prefix]));
                }
            }
        }

        Self { entries }
    }

    /// Returns `None` if the URL is permitted, or `Some(WebFetchOutput::DomainNotAllowed)`
    /// if it should be blocked. When `entries` is empty, all fetches are blocked.
    pub fn check(&self, url: &Url) -> Option<WebFetchOutput> {
        let Some(raw_host) = url.host_str() else {
            return Some(WebFetchOutput::DomainNotAllowed(String::new()));
        };
        let host = normalize_domain(raw_host);

        match self.entries.get(&host) {
            Some(HostEntry::AnyPath) => None,
            Some(HostEntry::PathPrefixes(prefixes)) => {
                let url_path = url.path().to_lowercase();
                if prefixes.iter().any(|prefix| {
                    url_path == *prefix
                        || (url_path.starts_with(prefix.as_str())
                            && url_path.as_bytes().get(prefix.len()) == Some(&b'/'))
                }) {
                    return None;
                }
                Some(WebFetchOutput::DomainNotAllowed(host))
            }
            None => Some(WebFetchOutput::DomainNotAllowed(host)),
        }
    }
}

/// Extract and normalize the domain from a raw URL string.
#[allow(dead_code)] // used by tests
pub fn domain_from_url(raw_url: &str) -> Option<String> {
    Url::parse(raw_url)
        .ok()
        .and_then(|u| u.host_str().map(normalize_domain))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn normalize_strips_www_and_trailing_dot() {
        assert_eq!(normalize_domain("www.Example.COM."), "example.com");
    }

    #[test]
    fn allows_listed_domain() {
        let m = DomainMatcher::new(&["docs.rs".into(), "Example.Com".into()]);
        assert!(m.check(&url("https://docs.rs/reqwest/latest")).is_none());
        assert!(m.check(&url("https://example.com/page")).is_none());
    }

    #[test]
    fn rejects_unlisted_domain() {
        let m = DomainMatcher::new(&["docs.rs".into()]);
        let blocked = m.check(&url("https://evil.com/steal"));
        assert!(matches!(blocked, Some(WebFetchOutput::DomainNotAllowed(d)) if d == "evil.com"));
    }

    #[test]
    fn blocks_all_when_empty() {
        let m = DomainMatcher::new(&[]);
        assert!(m.check(&url("https://docs.python.org/3/")).is_some());
    }

    #[test]
    fn www_prefix_stripped() {
        let m = DomainMatcher::new(&["react.dev".into()]);
        assert!(m.check(&url("https://www.react.dev/learn")).is_none());
    }

    #[test]
    fn path_scoped_allows_matching_path() {
        let m = DomainMatcher::new(&["vercel.com/docs".into()]);
        assert!(m.check(&url("https://vercel.com/docs")).is_none());
        assert!(m.check(&url("https://vercel.com/docs/foo")).is_none());
    }

    #[test]
    fn path_scoped_blocks_non_matching_path() {
        let m = DomainMatcher::new(&["vercel.com/docs".into()]);
        let blocked = m.check(&url("https://vercel.com/api"));
        assert!(matches!(blocked, Some(WebFetchOutput::DomainNotAllowed(h)) if h == "vercel.com"));
    }

    #[test]
    fn path_scoped_rejects_sibling_prefix() {
        let m = DomainMatcher::new(&["vercel.com/docs".into()]);
        assert!(m.check(&url("https://vercel.com/docs-internal")).is_some());
        assert!(m.check(&url("https://vercel.com/docs/guide")).is_none());
    }

    #[test]
    fn multiple_path_prefixes_per_host() {
        let m = DomainMatcher::new(&["github.com/org-a".into(), "github.com/org-b".into()]);
        assert!(m.check(&url("https://github.com/org-a/project-one")).is_none());
        assert!(m.check(&url("https://github.com/evil-org/malware")).is_some());
    }

    #[test]
    fn host_only_overrides_path_prefixes() {
        let m = DomainMatcher::new(&["github.com/docs".into(), "github.com".into()]);
        assert!(m.check(&url("https://github.com/anything")).is_none());
    }

    #[test]
    fn model_url_variants() {
        let m = DomainMatcher::new(&["docs.python.org".into(), "react.dev".into()]);
        assert!(m.check(&url("https://react.dev")).is_none());
        assert!(m.check(&url("https://www.react.dev/learn")).is_none());
        assert!(m.check(&url("https://evil.example.com/")).is_some());
    }

    #[test]
    fn domain_from_url_extracts_and_normalizes() {
        assert_eq!(
            domain_from_url("https://docs.python.org/3/library/asyncio.html"),
            Some("docs.python.org".to_string())
        );
        assert_eq!(domain_from_url("not a url"), None);
    }
}

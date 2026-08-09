//! URL secret detection (P1.5). Four-way secret-in-query detection mirroring
//!  `_PREFIX_RE`: raw, unquote, normalized (case/`%` folding), and
//! unquote-normalized. Sensitive query param names (api_key, token, secret,
//! key, password, etc.) with a non-empty value cause whole-URL rejection
//! (decision point 6: 整体拒绝, aligning with ).
//!
//! Pure functions — unit-tested.

use url::Url;

/// Parameter names that carry secrets. Matched case-insensitively against the
/// decoded param name.
const SENSITIVE_PARAM_NAMES: &[&str] = &[
    "api_key",
    "apikey",
    "api-key",
    "access_token",
    "accesstoken",
    "access-token",
    "auth_token",
    "authtoken",
    "auth-token",
    "refresh_token",
    "refreshtoken",
    "id_token",
    "idtoken",
    "client_secret",
    "clientsecret",
    "client-secret",
    "secret",
    "password",
    "passwd",
    "pwd",
    "token",
    "key",
    "sig",
    "signature",
    "sas",
    "sig",
];

/// The four URL forms checked (mirrors ' four-way `_PREFIX_RE`).
fn candidate_forms(url: &Url) -> Vec<String> {
    let raw = url.as_str().to_string();
    let unquoted = percent_decode(&raw);
    // Normalized: lowercase scheme+host, collapse case of the query, and
    // unify `%2F`-style encodings to a canonical shape.
    let normalized = normalize_url(&raw);
    let unquoted_normalized = normalize_url(&unquoted);
    vec![raw, unquoted, normalized, unquoted_normalized]
}

/// Percent-decode the URL query (repeatedly, to defeat double-encoding).
fn percent_decode(s: &str) -> String {
    let mut out = s.to_string();
    for _ in 0..2 {
        let parsed = Url::parse(&out);
        match parsed {
            Ok(u) => {
                let Some(q) = u.query() else { break };
                let mut new = u.clone();
                let decoded_q: Vec<String> = url::form_urlencoded::parse(q.as_bytes())
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect();
                new.set_query(Some(&decoded_q.join("&")));
                let s = new.as_str().to_string();
                if s == out {
                    break;
                }
                out = s;
            }
            Err(_) => break,
        }
    }
    out
}

/// Lowercase scheme + host, normalize `%2f`/`%2F` to `/` and `%3f` to `?`,
/// collapse duplicate path slashes (-style normalization).
fn normalize_url(s: &str) -> String {
    let mut out = s.to_string();
    // Case-fold the scheme+host region only (query values may be case-sensitive).
    if let Ok(mut u) = Url::parse(&out) {
        let scheme = u.scheme().to_ascii_lowercase();
        if let Some(host) = u.host_str().map(|h| h.to_ascii_lowercase()) {
            let _ = u.set_host(Some(&host));
        }
        if let Ok(mut updated) = u.to_string().parse::<Url>() {
            let _ = updated.set_scheme(&scheme);
            out = updated.to_string();
        }
    }
    // Unify percent-encoded separators.
    out = out
        .replace("%2F", "/")
        .replace("%2f", "/")
        .replace("%3F", "?")
        .replace("%3f", "?")
        .replace("%3D", "=")
        .replace("%3d", "=");
    // Collapse repeated slashes in the PATH only (never the `scheme://`).
    if let Ok(mut u) = Url::parse(&out) {
        let path = u.path();
        let collapsed = collapse_path(path);
        u.set_path(&collapsed);
        out = u.to_string();
    }
    out
}

/// Collapse `//` runs in a path, preserving leading slash.
fn collapse_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    let mut collapsed = String::with_capacity(trimmed.len());
    let mut prev_slash = false;
    for c in trimmed.chars() {
        if c == '/' && prev_slash {
            continue;
        }
        collapsed.push(c);
        prev_slash = c == '/';
    }
    let mut out = String::with_capacity(collapsed.len() + 1);
    out.push('/');
    out.push_str(&collapsed);
    out
}

/// Check the four candidate URL forms for a sensitive query param with a
/// non-empty value. Returns the offending param name (first match), or `None`.
pub fn detect_secret_in_query(url: &Url) -> Option<String> {
    for form in candidate_forms(url) {
        if let Some(param) = scan_single_form(&form) {
            return Some(param);
        }
    }
    None
}

fn scan_single_form(form: &str) -> Option<String> {
    let parsed = Url::parse(form).ok()?;
    let query = parsed.query()?;
    let mut found: Option<String> = None;
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        let key = k.to_ascii_lowercase();
        let value = v.trim();
        if value.is_empty() {
            continue;
        }
        if SENSITIVE_PARAM_NAMES
            .iter()
            .any(|name| key == *name || key.ends_with(&format!(".{name}")))
        {
            found = Some(key);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn rejects_api_key_in_query() {
        assert_eq!(
            detect_secret_in_query(&url("https://api.example.com/v1?api_key=sk-123")),
            Some("api_key".into())
        );
    }

    #[test]
    fn rejects_token_and_secret() {
        assert!(detect_secret_in_query(&url("https://x.com/?access_token=abc")).is_some());
        assert!(detect_secret_in_query(&url("https://x.com/?client_secret=abc")).is_some());
        assert!(detect_secret_in_query(&url("https://x.com/?password=hunter2")).is_some());
        assert!(detect_secret_in_query(&url("https://x.com/?sas=abc&sig=def")).is_some());
    }

    #[test]
    fn rejects_case_insensitive_and_encoded() {
        // Uppercase name.
        assert!(detect_secret_in_query(&url("https://x.com/?API_KEY=abc")).is_some());
        // Percent-encoded name.
        assert!(detect_secret_in_query(&url("https://x.com/?api%5Fkey=abc")).is_some());
    }

    #[test]
    fn rejects_double_encoded_value() {
        // `%2573k` decodes once to `%73k`, twice to `sk` — the unquote form
        // still carries the secret key name.
        let u = url("https://x.com/?key=%2573k-123");
        assert!(detect_secret_in_query(&u).is_some());
    }

    #[test]
    fn allows_non_secret_params() {
        assert!(detect_secret_in_query(&url("https://x.com/?q=rust&limit=10")).is_none());
        assert!(detect_secret_in_query(&url("https://x.com/?page=2")).is_none());
        // Empty value is not a leak.
        assert!(detect_secret_in_query(&url("https://x.com/?api_key=")).is_none());
    }

    #[test]
    fn allows_key_like_non_secret_words() {
        // "key" is in the sensitive list but "keyword"/"keyboard" are not
        // exact matches and must not be rejected.
        assert!(detect_secret_in_query(&url("https://x.com/?keyword=rust")).is_none());
    }

    #[test]
    fn rejects_secret_in_path_via_encoded_form() {
        // An encoded `?` smuggles a secret-looking query into the path; the
        // normalized form catches it.
        let u = url("https://x.com/page%3Fapi_key%3Dabc");
        assert!(detect_secret_in_query(&u).is_some());
    }
}

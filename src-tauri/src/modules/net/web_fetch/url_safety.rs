//! URL secret detection (P1.5). Four-way secret-in-query detection mirroring
//!  `_PREFIX_RE`: raw, unquote, normalized (case/`%` folding), and
//! unquote-normalized. Sensitive query param names (api_key, token, secret,
//! key, password, etc.) with a non-empty value cause whole-URL rejection
//! (decision point 6: 整体拒绝, aligning with ).
//!
//! Pure functions — unit-tested.

use regex::Regex;
use std::sync::OnceLock;
use url::Url;

/// Vendor key/token prefixes, lowercased and sorted longest-first. This is the
/// "prefix gate" (first of two gates, mirroring ' `_PREFIX_RE`): it catches
/// secrets that land in the path, fragment, or a no-query URL — places the
/// sensitive-param-name gate (`SENSITIVE_PARAM_NAMES`) cannot see because it
/// only inspects the query string. Each prefix is matched at a word boundary
/// so it is not flagged when embedded inside a normal word (e.g. `skillful`).
const PREFIX_PATTERNS: &[&str] = &[
    "github_pat_", // GitHub fine-grained PAT
    "retaindb_",   // RetainDB API key
    "dop_v1_",     // DigitalOcean PAT
    "doo_v1_",     // DigitalOcean OAuth
    "bb_live_",    // BrowserBase
    "sk_live_",    // Stripe secret key (live)
    "sk_test_",    // Stripe secret key (test)
    "rk_live_",    // Stripe restricted key
    "sk-ant-",     // Anthropic
    "tvly-",       // Tavily search API key
    "pplx-",       // Perplexity
    "pypi-",       // PyPI API token
    "xapp-",       // Slack app-level token
    "hsk-",        // Hindsight API key
    "xai-",        // xAI (Grok) API key
    "fw-",         // Fireworks AI API key
    "fc-",         // Firecrawl
    "gsk_",        // Groq Cloud API key
    "ghp_",        // GitHub PAT (classic)
    "gho_",        // GitHub OAuth access token
    "ghu_",        // GitHub user-to-server token
    "ghs_",        // GitHub server-to-server token
    "ghr_",        // GitHub refresh token
    "syt_",        // Matrix access token
    "mem0_",       // Mem0 Platform API key
    "brv_",        // ByteRover API key
    "ntn_",        // Notion integration token
    "exa_",        // Exa search API key
    "fal_",        // Fal.ai
    "fpk_",        // Fireworks project key
    "hf_",         // HuggingFace token
    "r8_",         // Replicate API token
    "npm_",        // npm access token
    "am_",         // AgentMail API key
    "fw_",         // Fireworks AI API key
    "sk_",         // ElevenLabs TTS key
    "sk-",         // OpenAI / OpenRouter
    "aiza",        // Google (case-folded AIza)
    "akia",        // AWS Access Key ID (case-folded AKIA)
    "gaaaa",       // Codex encrypted tokens (case-folded gAAAA)
    "sg.",         // SendGrid (case-folded SG.)
    "xox",         // Slack (b/a/p/r/s variants)
];

/// Compiled alternation of `PREFIX_PATTERNS` anchored at a word boundary.
///
/// The `regex` crate has no look-around, so the "not preceded by a token char"
/// boundary is expressed with a leading `(?:^|[^A-Za-z0-9_-])`: the prefix must
/// be at the very start of the URL or preceded by a non-token character (`/`,
/// `?`, `#`, `=`, etc.). This prevents flagging a prefix embedded inside a
/// larger word (e.g. `foskey`/`skillful` contain `sk` but not `sk-` at a
/// boundary). No strict trailing lookahead is used: real keys continue with
/// token chars after the prefix (`sk-ant-xxx`), so a trailing boundary would
/// defeat the gate. The matched prefix is captured in the `pre` group.
fn prefix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        let alt = PREFIX_PATTERNS
            .iter()
            .map(|p| regex::escape(p))
            .collect::<Vec<_>>()
            .join("|");
        Regex::new(&format!(r"(?:^|[^A-Za-z0-9_-])(?P<pre>{alt})")).unwrap()
    })
}

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

/// Vendor-prefix gate. Scans the **whole URL** (path, fragment, no-query — not
/// just the query string) across the four candidate forms for a recognizable
/// vendor key/token prefix. Returns the matched prefix (lowercased) or `None`.
///
/// This is the first of two gates; `detect_secret_in_query` remains the second
/// (sensitive param names). They are intentionally independent and both reject
/// the whole URL when they hit.
pub fn detect_secret_prefix_in_url(url: &Url) -> Option<&'static str> {
    let re = prefix_regex();
    for form in candidate_forms(url) {
        // Prefixes are stored lowercased; compare against a case-folded URL so
        // vendor shapes like `AIza`/`AKIA`/`SG.` are caught regardless of case.
        let lower = form.to_ascii_lowercase();
        if let Some(caps) = re.captures(&lower) {
            if let Some(m) = caps.name("pre") {
                let text = m.as_str();
                for p in PREFIX_PATTERNS {
                    if text == *p {
                        return Some(p);
                    }
                }
                // Fallback (shouldn't happen): match is one of the prefixes.
                return Some(PREFIX_PATTERNS[0]);
            }
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

    // ── Vendor-prefix gate (detect_secret_prefix_in_url) ──────────────────

    #[test]
    fn prefix_rejects_secret_in_path() {
        let u = url("https://evil.com/sk-ant-api03-abc1234567890");
        assert_eq!(detect_secret_prefix_in_url(&u), Some("sk-ant-"));
    }

    #[test]
    fn prefix_rejects_secret_under_non_sensitive_param() {
        // `ref` is not in SENSITIVE_PARAM_NAMES, but the value carries a
        // recognizable vendor prefix — the prefix gate must catch it.
        let u = url("https://x.com/?ref=ghp_AbC1234DeFgH5IjK6LmN7OpQ");
        assert_eq!(detect_secret_prefix_in_url(&u), Some("ghp_"));
    }

    #[test]
    fn prefix_rejects_secret_in_fragment() {
        let u = url("https://x.com/page#sk-abcdefghijklmnop");
        assert_eq!(detect_secret_prefix_in_url(&u), Some("sk-"));
    }

    #[test]
    fn prefix_rejects_secret_in_no_query_url() {
        // No `?` at all — the param-name gate sees nothing, the prefix gate must.
        let u = url("https://x.com/sk_live_4Cq8ZkL1mNxY9wQ2rT");
        assert_eq!(detect_secret_prefix_in_url(&u), Some("sk_live_"));
    }

    #[test]
    fn prefix_rejects_uppercase_vendor_prefix() {
        // Case-folded comparison catches uppercase vendor shapes.
        let u = url("https://x.com/dl/AIzaSyDdS0u5dF9j1X2y3z4A5b6C7d8e9f0g1h2i3");
        assert_eq!(detect_secret_prefix_in_url(&u), Some("aiza"));
        let u2 = url("https://x.com/?k=SG.abc123def456ghi789");
        assert_eq!(detect_secret_prefix_in_url(&u2), Some("sg."));
    }

    #[test]
    fn prefix_rejects_double_encoded_value() {
        // `%2573k` decodes once to `%73k`, twice to `sk-`; the unquoted form
        // still carries the prefix.
        let u = url("https://x.com/?ref=%2573k-abcdefghijklm");
        assert_eq!(detect_secret_prefix_in_url(&u), Some("sk-"));
    }

    #[test]
    fn prefix_word_boundary_no_false_positive() {
        // `foskey`/`skillful` contain `sk` but not `sk-` at a word boundary;
        // `example` contains `exa` but not `exa_`. None may be flagged.
        assert_eq!(
            detect_secret_prefix_in_url(&url("https://x.com/foskey")),
            None
        );
        assert_eq!(
            detect_secret_prefix_in_url(&url("https://x.com/skillful")),
            None
        );
        assert_eq!(
            detect_secret_prefix_in_url(&url("https://example.com/rust")),
            None
        );
    }

    #[test]
    fn prefix_allows_legal_url() {
        let u = url("https://api.example.com/v1/search?q=rust&limit=10#results");
        assert_eq!(detect_secret_prefix_in_url(&u), None);
    }

    #[test]
    fn prefix_gate_does_not_regress_param_name_gate() {
        // Parameter-name gate still fires independently of the prefix gate.
        let u = url("https://x.com/?api_key=opaque-not-a-vendor-prefix");
        assert_eq!(detect_secret_in_query(&u), Some("api_key".into()));
        assert_eq!(detect_secret_prefix_in_url(&u), None);
    }
}

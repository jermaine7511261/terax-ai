//! Fetch-content cleaning heuristics (P1.5 L1 增强, webclaw/crw port). Pure
//! functions deciding WHEN to retry-fallback (sparse content), whether a page
//! is noise-heavy (link-density penalty), the 5000-char noise inversion
//! guardrail, and OG/Twitter/title metadata extraction. All unit-tested.

use scraper::{Html, Selector};

/// Noise inversion guardrail: a page whose extraction is mostly boilerplate
/// (nav/footer/ads) but that contains < 5000 chars of real content gets its
/// "cleaned" text thrown away and the raw body kept, because the cleaner lost
/// signal. Mirrors webclaw's 5000-char noise guardrail.
pub const NOISE_GUARDRAIL_CHARS: usize = 5000;

/// Link-density penalty (webclaw `noise`): fraction of anchor text in a region.
/// Above `LINK_DENSITY_THRESHOLD` the region is treated as navigation/boilerplate.
pub const LINK_DENSITY_THRESHOLD: f64 = 0.4;

/// Two-level retry fallback decision (webclaw `extractor`): when the
/// "main content only" extraction is sparse (fewer than `min_main_chars`) AND
/// the full-body extraction is at least `compare_ratio`x larger, re-fetch with
/// the broader extractor so content isn't lost.
pub const MIN_MAIN_CHARS: usize = 200;
pub const MAIN_TO_BODY_COMPARE_RATIO: f64 = 2.0;

/// Link density of a text region: anchor-text chars / total chars.
pub fn link_density(html: &str) -> f64 {
    let doc = Html::parse_fragment(html);
    let Ok(anchor_sel) = Selector::parse("a") else {
        return 0.0;
    };
    let mut anchor_text_len = 0usize;
    for a in doc.select(&anchor_sel) {
        anchor_text_len += a.text().collect::<String>().chars().count();
    }
    let total = doc.root_element().text().collect::<String>().chars().count();
    if total == 0 {
        return 0.0;
    }
    anchor_text_len as f64 / total as f64
}

/// Whether a region is navigation/boilerplate by link density.
pub fn is_high_link_density(html: &str) -> bool {
    link_density(html) >= LINK_DENSITY_THRESHOLD
}

/// Decide whether to retry with the broad extractor: main-only extraction is
/// suspiciously sparse and the full body is significantly larger.
pub fn should_retry_broad(main_chars: usize, body_chars: usize) -> bool {
    if main_chars >= MIN_MAIN_CHARS {
        return false;
    }
    body_chars as f64 >= main_chars as f64 * MAIN_TO_BODY_COMPARE_RATIO
}

/// The noise guardrail: if the "cleaned" output shrank below the guardrail
/// while the original had substantial text, prefer the original (inversion).
pub fn apply_noise_guardrail(cleaned: &str, original: &str) -> String {
    if cleaned.chars().count() < NOISE_GUARDRAIL_CHARS
        && original.chars().count() > cleaned.chars().count() * 2
    {
        original.to_string()
    } else {
        cleaned.to_string()
    }
}

/// Metadata extraction with three-level fallback: `og:title`/`og:description`
/// → `twitter:title`/`twitter:description` → `<title>`/`<meta name=description>`.
pub fn extract_metadata(html: &str) -> Metadata {
    let doc = Html::parse_document(html);

    let og = meta_property(&doc, "og:title").or_else(|| meta_property(&doc, "og:description"));
    let twitter =
        meta_name(&doc, "twitter:title").or_else(|| meta_name(&doc, "twitter:description"));
    let title = html_title(&doc).or_else(|| meta_name(&doc, "description"));

    Metadata {
        og_title: meta_property(&doc, "og:title"),
        og_description: meta_property(&doc, "og:description"),
        twitter_title: meta_name(&doc, "twitter:title"),
        twitter_description: meta_name(&doc, "twitter:description"),
        html_title: html_title(&doc),
        meta_description: meta_name(&doc, "description"),
        // Three-level fallback (webclaw metadata): og > twitter > html.
        best_title: og.or(twitter).or(title),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Metadata {
    pub og_title: Option<String>,
    pub og_description: Option<String>,
    pub twitter_title: Option<String>,
    pub twitter_description: Option<String>,
    pub html_title: Option<String>,
    pub meta_description: Option<String>,
    pub best_title: Option<String>,
}

fn html_title(doc: &Html) -> Option<String> {
    let sel = Selector::parse("title").ok()?;
    doc.select(&sel).next().map(|e| e.text().collect::<String>().trim().to_string())
}

fn meta_property(doc: &Html, prop: &str) -> Option<String> {
    let sel = Selector::parse(r#"meta[property]"#).ok()?;
    for e in doc.select(&sel) {
        let v = e.value().attr("property").unwrap_or("");
        if v.eq_ignore_ascii_case(prop) {
            return e.value().attr("content").map(|c| c.trim().to_string());
        }
    }
    None
}

fn meta_name(doc: &Html, name: &str) -> Option<String> {
    let sel = Selector::parse(r#"meta[name]"#).ok()?;
    for e in doc.select(&sel) {
        let v = e.value().attr("name").unwrap_or("");
        if v.eq_ignore_ascii_case(name) {
            return e.value().attr("content").map(|c| c.trim().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn high_link_density_is_boilerplate() {
        let nav = r#"<nav><a href="/a">Home</a><a href="/b">About</a><a href="/c">Docs</a><a href="/d">Blog</a><a href="/e">Contact</a><a href="/f">Pricing</a><a href="/g">FAQ</a></nav>"#;
        assert!(is_high_link_density(nav));
        let article = r#"<article><p>The Rust programming language enables memory-safe concurrency with zero cost abstractions.</p></article>"#;
        assert!(!is_high_link_density(article));
    }

    #[test]
    fn sparse_main_triggers_broad_retry() {
        assert!(should_retry_broad(80, 5000)); // main tiny, body big
        assert!(!should_retry_broad(400, 5000)); // main already adequate
        assert!(!should_retry_broad(80, 100)); // body not much bigger
    }

    #[test]
    fn noise_guardrail_keeps_original_when_cleaner_lost_signal() {
        let original = "real content ".repeat(300); // 3600 chars
        let cleaned = "x"; // cleaner nuked everything
        let out = apply_noise_guardrail(cleaned, &original);
        assert_eq!(out, original);
    }

    #[test]
    fn noise_guardrail_keeps_cleaner_when_healthy() {
        let cleaned = "real content ".repeat(600); // 7200 chars
        let original = cleaned.clone();
        assert_eq!(apply_noise_guardrail(&cleaned, &original), cleaned);
    }

    #[test]
    fn metadata_three_level_fallback() {
        let html = r#"<html>
          <head>
            <title>Fallback Title</title>
            <meta name="description" content="Meta description">
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Desc">
          </head></html>"#;
        let m = extract_metadata(html);
        assert_eq!(m.best_title.as_deref(), Some("OG Title"));
        assert_eq!(m.html_title.as_deref(), Some("Fallback Title"));
        assert_eq!(m.meta_description.as_deref(), Some("Meta description"));
    }

    #[test]
    fn metadata_falls_to_html_title_without_og() {
        let html = r#"<html><head><title>Plain Title</title></head></html>"#;
        let m = extract_metadata(html);
        assert_eq!(m.best_title.as_deref(), Some("Plain Title"));
        assert_eq!(m.og_title, None);
    }

    #[test]
    fn metadata_uses_twitter_when_og_missing() {
        let html = r#"<html><head><meta name="twitter:title" content="Tweet Title"></head></html>"#;
        let m = extract_metadata(html);
        assert_eq!(m.best_title.as_deref(), Some("Tweet Title"));
    }
}

//! Report synthesis (P3): render verified claims into a cited markdown report,
//! mirroring the frontend `deepSearch.ts` Phase-4 report format. Pure.

use super::verify::Claim;

/// Build the final cited markdown report from verified claims + coverage notes.
pub fn synthesize_report(
    query: &str,
    verified: &[Claim],
    coverage_notes: &[String],
) -> String {
    let status = if verified.is_empty() { "Partial" } else { "Verified" };
    let mut out = format!(
        "# Research result\n\n**Status: {status}**\n\n## Findings\n"
    );
    if verified.is_empty() {
        out.push_str("\nNo supported factual answer could be produced.\n");
    } else {
        for (i, c) in verified.iter().enumerate() {
            out.push_str(&format!(
                "- {} [S{}] — {}: {}\n",
                c.claim,
                i + 1,
                c.source_title,
                c.source_locator
            ));
        }
    }
    out.push_str("\n## Sources\n");
    for (i, c) in verified.iter().enumerate() {
        out.push_str(&format!("- [S{}] {} — {}\n", i + 1, c.source_title, c.source_locator));
    }
    if !coverage_notes.is_empty() {
        out.push_str("\n## Coverage and uncertainty\n");
        for n in coverage_notes {
            out.push_str(&format!("- {n}\n"));
        }
    }
    let _ = query;
    out
}

/// Concise status line for the poll response (progress indicator).
pub fn status_line(query: &str, phase: &str, verified: usize, total: usize) -> String {
    format!(
        "deep_search: {phase} (query: {q}, verified {verified}/{total})",
        q = if query.chars().count() > 48 {
            format!("{}…", query.chars().take(48).collect::<String>())
        } else {
            query.to_string()
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(id: &str) -> Claim {
        Claim {
            id: id.to_string(),
            claim: format!("claim {id}"),
            evidence: format!("ev {id}"),
            source_title: format!("Source {id}"),
            source_locator: format!("https://example.com/{id}"),
        }
    }

    #[test]
    fn verified_report_has_findings_and_sources() {
        let r = synthesize_report("q", &[claim("c1"), claim("c2")], &[]);
        assert!(r.contains("**Status: Verified**"));
        assert!(r.contains("[S1]"));
        assert!(r.contains("[S2]"));
        assert!(r.contains("## Sources"));
        assert!(r.contains("Source c1 — https://example.com/c1"));
    }

    #[test]
    fn partial_report_when_nothing_verified() {
        let r = synthesize_report("q", &[], &["no evidence".to_string()]);
        assert!(r.contains("**Status: Partial**"));
        assert!(r.contains("No supported factual answer"));
        assert!(r.contains("## Coverage and uncertainty"));
        assert!(r.contains("- no evidence"));
    }

    #[test]
    fn status_line_truncates_long_query() {
        let long = "x".repeat(100);
        let s = status_line(&long, "research", 3, 4);
        assert!(s.len() < 100 + 30);
        assert!(s.contains("verified 3/4"));
    }
}

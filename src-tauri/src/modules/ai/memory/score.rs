//! Memory scoring + rerank pure core (P2), mirroring the frontend
//! `memoryStore.ts` (recallScore/recallTop) and grok `xai-grok-memory/search.rs`
//! (time decay + MMR + min_score). No I/O — unit-tested.

use std::collections::HashSet;

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "are", "with", "this", "that", "from", "have", "was", "has", "you",
    "how", "what", "when", "where", "which", "please",
];

/// Tokenize a query into non-trivial tokens (len >= 3, not a stopword).
/// CJK characters count as alphabetic, so an unspaced CJK sentence stays one
/// token (the 2-gram path handles it).
fn query_tokens(query: &str) -> Vec<String> {
    let q = query.to_lowercase();
    q.split(|c: char| !(c.is_alphabetic() || c.is_numeric()))
        .filter(|t| t.chars().count() >= 3 && !STOPWORDS.contains(t))
        .map(str::to_string)
        .collect()
}

fn is_cjk(s: &str) -> bool {
    s.chars().any(|c| matches!(c, '\u{4e00}'..='\u{9fff}'))
}

/// Relevance score 0..1 between a memory line and a query. Latin/alnum tokens
/// use exact-word semantics; CJK tokens (no spaces) use 2-gram overlap so a
/// longer sentence query still recalls lines sharing any bigrams.
pub fn recall_score(line: &str, query: &str) -> f64 {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return 0.0;
    }
    let line_lower = line.to_ascii_lowercase();
    let mut score = 0.0;
    for t in &tokens {
        if is_cjk(t) {
            let mut grams = HashSet::new();
            let chars: Vec<char> = t.chars().collect();
            for w in chars.windows(2) {
                grams.insert(w.iter().collect::<String>());
            }
            if grams.is_empty() {
                continue;
            }
            let mut hit = 0;
            for g in &grams {
                if line_lower.contains(g) {
                    hit += 1;
                }
            }
            score += hit as f64 / grams.len() as f64;
        } else if line_lower.contains(t.as_str()) {
            score += 1.0;
        }
    }
    score / tokens.len() as f64
}

/// Rank lines by relevance, returning the top `limit` above `threshold`.
pub fn recall_top(
    lines: &[&str],
    query: &str,
    limit: usize,
    threshold: f64,
) -> Vec<String> {
    let mut scored: Vec<(usize, f64, &str)> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| (i, recall_score(l, query), *l))
        .filter(|(_, s, _)| *s > threshold)
        .collect();
    // Stable by descending score, then original index (preserve input order).
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    scored.into_iter().take(limit).map(|(_, _, l)| l.to_string()).collect()
}

/// MMR (Maximal Marginal Relevance) rerank: greedily pick the next line that
/// best balances relevance vs. redundancy against already-picked lines. Uses
/// bigram-overlap similarity as the redundancy proxy. `lambda` blends
/// relevance (1.0) with novelty (0.0).
pub fn mmr_rerank(
    scored: &[(String, f64)],
    limit: usize,
    lambda: f64,
) -> Vec<(String, f64)> {
    let mut picked: Vec<usize> = Vec::new();
    let mut out: Vec<(String, f64)> = Vec::new();
    let n = scored.len();
    while picked.len() < limit.min(n) {
        let mut best: Option<(usize, f64)> = None;
        for (i, (text, rel)) in scored.iter().enumerate() {
            if picked.contains(&i) {
                continue;
            }
            let mut max_sim = 0.0f64;
            for &j in &picked {
                let sim = bigram_similarity(text, &scored[j].0);
                if sim > max_sim {
                    max_sim = sim;
                }
            }
            let mmr = lambda * rel + (1.0 - lambda) * (1.0 - max_sim);
            if best.map(|(_, b)| mmr > b).unwrap_or(true) {
                best = Some((i, mmr));
            }
        }
        if let Some((i, mmr)) = best {
            picked.push(i);
            out.push((scored[i].0.clone(), mmr));
        } else {
            break;
        }
    }
    out
}

fn bigrams(s: &str) -> HashSet<String> {
    let lower = s.to_ascii_lowercase();
    let chars: Vec<char> = lower.chars().collect();
    chars
        .windows(2)
        .map(|w| w.iter().collect())
        .collect()
}

fn bigram_similarity(a: &str, b: &str) -> f64 {
    let ga = bigrams(a);
    let gb = bigrams(b);
    if ga.is_empty() || gb.is_empty() {
        return 0.0;
    }
    let inter = ga.intersection(&gb).count();
    inter as f64 / ga.union(&gb).count().max(1) as f64
}

/// Time decay (grok: session half-life, global/workspace permanent). Returns
/// a 0..1 multiplier that halves after `half_life_secs`.
pub fn time_decay(age_secs: f64, half_life_secs: f64) -> f64 {
    if half_life_secs <= 0.0 {
        return 1.0; // permanent scope
    }
    (-age_secs / half_life_secs).exp2()
}

/// Combine BM25/lexical score with time decay + source weight. `min_score`
/// filters below the floor (grok `min_score`).
pub fn final_score(lexical: f64, age_secs: f64, half_life_secs: f64, source_weight: f64) -> f64 {
    lexical * time_decay(age_secs, half_life_secs) * source_weight
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_token_match_scores_one() {
        assert_eq!(recall_score("we use pnpm for package management", "pnpm"), 1.0);
    }

    #[test]
    fn no_match_scores_zero() {
        assert_eq!(recall_score("nothing here", "pnpm"), 0.0);
    }

    #[test]
    fn stopwords_and_short_tokens_ignored() {
        assert_eq!(recall_score("unrelated text", "how the"), 0.0);
    }

    #[test]
    fn partial_match_between_zero_and_one() {
        let s = recall_score("configure pnpm settings", "pnpm build");
        assert!(s > 0.0 && s < 1.0);
    }

    #[test]
    fn cjk_two_gram_overlap_recalls() {
        // Query has two CJK tokens (space-separated). Both should hit the line.
        let s = recall_score("- 2026-08-07 记忆注入层重构为召回式注入", "记忆注入全量拼接 召回式注入");
        assert!(s > 0.0, "expected >0, got {s}");
    }

    #[test]
    fn recall_top_ranks_relevant_first() {
        let lines = [
            "- we use pnpm for dependencies",
            "- the build command is pnpm build",
            "- deploy to the staging server",
        ];
        let top = recall_top(&lines, "pnpm build", 8, 0.0);
        assert!(top[0].contains("pnpm"));
    }

    #[test]
    fn recall_top_respects_limit() {
        let lines = ["a pnpm x", "b pnpm y", "c pnpm z"];
        assert_eq!(recall_top(&lines, "pnpm", 1, 0.0).len(), 1);
    }

    #[test]
    fn recall_top_threshold_filters() {
        // Mirrors the frontend test: none of these lines mention quantum/physics.
        let lines = [
            "- we use pnpm for dependencies",
            "- the build command is pnpm build",
            "- deploy to the staging server",
        ];
        assert!(recall_top(&lines, "quantum physics", 8, 0.9).is_empty());
    }

    #[test]
    fn recall_top_empty_inputs() {
        assert!(recall_top(&[], "anything", 8, 0.0).is_empty());
        assert!(recall_top(&["x"], "", 8, 0.0).is_empty());
    }

    #[test]
    fn time_decay_halves_each_half_life() {
        assert!((time_decay(0.0, 3600.0) - 1.0).abs() < 1e-9);
        assert!((time_decay(3600.0, 3600.0) - 0.5).abs() < 1e-9);
        assert!((time_decay(7200.0, 3600.0) - 0.25).abs() < 1e-9);
        assert_eq!(time_decay(9999.0, 0.0), 1.0); // permanent
    }

    #[test]
    fn final_score_combines_all_factors() {
        let s = final_score(0.8, 3600.0, 3600.0, 0.5);
        assert!((s - 0.2).abs() < 1e-9); // 0.8 * 0.5 * 0.5
    }

    #[test]
    fn mmr_reduces_redundancy() {
        let scored = vec![
            ("rust async book guide".to_string(), 1.0),
            ("rust async book tutorial".to_string(), 0.95),
            ("unrelated topic".to_string(), 0.1),
        ];
        let out = mmr_rerank(&scored, 3, 0.7);
        assert_eq!(out.len(), 3);
        // Greedy picks most relevant first, then the diverse one.
        assert_eq!(out[0].0, "rust async book guide");
        assert_eq!(out[2].0, "unrelated topic");
    }
}

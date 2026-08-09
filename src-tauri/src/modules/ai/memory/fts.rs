//! §3.5.2 Pure-Rust full-text search (BM25 inverted index) over session messages.
//!
//! No sqlite dependency — implements tokenization (ASCII + CJK bigram),
//! inverted index construction, and BM25 ranking from scratch.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/// Tokenize text into lowercase terms. ASCII words are split on non-alphanumeric;
/// CJK characters produce bigrams (each consecutive pair).
pub fn tokenize(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut tokens = Vec::new();
    let mut current_word = String::new();
    let mut cjk_buf = Vec::new();

    for ch in lower.chars() {
        if is_cjk(ch) {
            if !current_word.is_empty() {
                tokens.push(std::mem::take(&mut current_word));
            }
            cjk_buf.push(ch);
        } else {
            flush_cjk(&cjk_buf, &mut tokens);
            cjk_buf.clear();
            if ch.is_alphanumeric() {
                current_word.push(ch);
            } else if !current_word.is_empty() {
                tokens.push(std::mem::take(&mut current_word));
            }
        }
    }
    if !current_word.is_empty() {
        tokens.push(current_word);
    }
    flush_cjk(&cjk_buf, &mut tokens);
    tokens.retain(|t| !t.is_empty());
    tokens
}

fn is_cjk(ch: char) -> bool {
    matches!(ch,
        '\u{4E00}'..='\u{9FFF}' |
        '\u{3400}'..='\u{4DBF}' |
        '\u{F900}'..='\u{FAFF}' |
        '\u{20000}'..='\u{2FA1F}'
    )
}

fn flush_cjk(buf: &[char], out: &mut Vec<String>) {
    for window in buf.windows(2) {
        let bigram = format!("{}{}", window[0], window[1]);
        out.push(bigram);
    }
    if buf.len() == 1 {
        out.push(buf[0].to_string());
    }
}

// ---------------------------------------------------------------------------
// Inverted Index + BM25
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Doc {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsHit {
    pub id: String,
    pub text: String,
    pub score: f64,
    pub snippet: String,
}

struct Postings {
    tf: Vec<(usize, u32)>,
}

struct Index {
    terms: Vec<(String, Postings)>,
    doc_lens: Vec<u32>,
    n: u32,
    avg_dl: f64,
}

fn build_index(docs: &[Doc]) -> Index {
    let mut term_map: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut doc_tokens_vec: Vec<Vec<String>> = Vec::with_capacity(docs.len());
    let mut doc_lens: Vec<u32> = Vec::with_capacity(docs.len());

    for doc in docs {
        let tokens = tokenize(&doc.text);
        doc_lens.push(tokens.len() as u32);
        let mut term_freq: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for t in &tokens {
            *term_freq.entry(t.clone()).or_insert(0) += 1;
        }
        for term in term_freq.keys() {
            let len = term_map.len();
            term_map.entry(term.clone()).or_insert(len);
        }
        doc_tokens_vec.push(tokens);
    }

    let num_terms = term_map.len();
    let mut postings: Vec<Postings> = (0..num_terms)
        .map(|_| Postings { tf: Vec::new() })
        .collect();

    for (doc_idx, tokens) in doc_tokens_vec.iter().enumerate() {
        let mut term_freq: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for t in tokens {
            *term_freq.entry(t.clone()).or_insert(0) += 1;
        }
        for (term, &freq) in &term_freq {
            if let Some(&idx) = term_map.get(term) {
                postings[idx].tf.push((doc_idx, freq));
            }
        }
    }

    let terms = (0..num_terms)
        .map(|i| {
            let term = term_map.iter().find(|(_, &v)| v == i).map(|(k, _)| k.clone()).unwrap_or_default();
            (term, std::mem::replace(&mut postings[i], Postings { tf: Vec::new() }))
        })
        .collect();

    let total_dl: u64 = doc_lens.iter().map(|&l| l as u64).sum();
    let avg_dl = if docs.is_empty() { 1.0 } else { total_dl as f64 / docs.len() as f64 };

    Index { terms, doc_lens, n: docs.len() as u32, avg_dl }
}

fn bm25_score(index: &Index, query_terms: &[String], doc_idx: usize) -> f64 {
    let k1: f64 = 1.2;
    let b: f64 = 0.75;
    let dl = index.doc_lens[doc_idx] as f64;
    let mut score = 0.0;

    for qt in query_terms {
        if let Some((_, postings)) = index.terms.iter().find(|(t, _)| t == qt) {
            let df = postings.tf.len() as f64;
            if df == 0.0 { continue; }
            let idf = ((index.n as f64 - df + 0.5) / (df + 0.5) + 1.0).ln();
            if let Some((_, tf)) = postings.tf.iter().find(|(i, _)| *i == doc_idx) {
                let tf = *tf as f64;
                let norm = 1.0 - b + b * (dl / index.avg_dl);
                let tf_norm = (tf * (k1 + 1.0)) / (tf + k1 * norm);
                score += idf * tf_norm;
            }
        }
    }
    score
}

pub fn fts_search(docs: &[Doc], query: &str, limit: usize) -> Vec<FtsHit> {
    if docs.is_empty() || query.trim().is_empty() {
        return Vec::new();
    }

    let query_terms = tokenize(query);
    if query_terms.is_empty() { return Vec::new(); }

    let index = build_index(docs);
    let k = limit.max(1);

    let mut scored: Vec<(usize, f64)> = (0..docs.len())
        .map(|i| (i, bm25_score(&index, &query_terms, i)))
        .filter(|(_, s)| *s > 0.0)
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);

    scored
        .into_iter()
        .map(|(i, score)| {
            let doc = &docs[i];
            let snippet = make_snippet(&doc.text, &query_terms, 200);
            FtsHit { id: doc.id.clone(), text: doc.text.clone(), score, snippet }
        })
        .collect()
}

fn make_snippet(text: &str, query_terms: &[String], max_len: usize) -> String {
    let lower = text.to_lowercase();
    let mut best_pos = None;
    for qt in query_terms {
        if let Some(pos) = lower.find(qt.as_str()) {
            if best_pos.is_none_or(|b: usize| pos < b) {
                best_pos = Some(pos);
            }
        }
    }
    let pos = best_pos.unwrap_or(0);
    let half = max_len / 2;
    let start = pos.saturating_sub(half);
    let end = text.len().min(start + max_len);
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < text.len() { "…" } else { "" };
    format!("{prefix}{}{suffix}", &text[start..end])
}

// ---------------------------------------------------------------------------
// Tauri Command
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FtsDoc {
    pub id: String,
    pub text: String,
}

#[tauri::command]
pub fn memory_fts_search(
    corpus: Vec<FtsDoc>,
    query: String,
    limit: Option<usize>,
) -> Vec<FtsHit> {
    let docs: Vec<Doc> = corpus.into_iter().map(|c| Doc { id: c.id, text: c.text }).collect();
    fts_search(&docs, &query, limit.unwrap_or(8))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_splits_ascii_words() {
        let tokens = tokenize("Hello World! foo-bar baz");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
        assert!(tokens.contains(&"baz".to_string()));
    }

    #[test]
    fn tokenize_produces_cjk_bigrams() {
        let tokens = tokenize("你好世界");
        assert!(tokens.contains(&"你好".to_string()));
        assert!(tokens.contains(&"好世".to_string()));
        assert!(tokens.contains(&"世界".to_string()));
    }

    #[test]
    fn fts_search_returns_ranked_results() {
        let docs = vec![
            Doc { id: "1".into(), text: "Rust is a systems programming language".into() },
            Doc { id: "2".into(), text: "Python is great for data science".into() },
            Doc { id: "3".into(), text: "Rust ownership ensures memory safety".into() },
        ];
        let hits = fts_search(&docs, "rust", 10);
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|h| h.id == "1" || h.id == "3"));
        assert!(hits[0].score >= hits.last().unwrap().score);
    }

    #[test]
    fn bm25_prefers_term_frequency() {
        let docs = vec![
            Doc { id: "1".into(), text: "rust rust rust".into() },
            Doc { id: "2".into(), text: "rust".into() },
        ];
        let hits = fts_search(&docs, "rust", 10);
        assert_eq!(hits.len(), 2);
        assert!(hits[0].id == "1");
    }

    #[test]
    fn empty_query_returns_empty() {
        let docs = vec![Doc { id: "1".into(), text: "hello".into() }];
        assert!(fts_search(&docs, "", 10).is_empty());
        assert!(fts_search(&docs, "   ", 10).is_empty());
    }
}

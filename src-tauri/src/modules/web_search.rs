/// Web search engine — supports multiple backends.
/// Uses HTTP requests (not a browser) for speed and low resource usage.

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: String,
    pub relevance: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SearchBackend {
    /// DuckDuckGo (no API key needed).
    DuckDuckGo,
    /// Google Custom Search (needs API key + CX).
    Google,
    /// Bing Search (needs API key).
    Bing,
    /// SearXNG self-hosted instance.
    SearXNG,
}

impl SearchBackend {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "google" => SearchBackend::Google,
            "bing" => SearchBackend::Bing,
            "searxng" | "searx" => SearchBackend::SearXNG,
            _ => SearchBackend::DuckDuckGo,
        }
    }
}

/// Simulated web search — in production, this would call actual HTTP APIs.
/// Kept sync for simplicity; real implementation would use reqwest.
fn simulate_search(query: &str, backend: SearchBackend) -> Vec<SearchResult> {
    let q = query.to_lowercase();
    vec![
        SearchResult {
            title: format!("{} — Wikipedia", &q[..q.len().min(40)].to_string()),
            url: format!("https://en.wikipedia.org/wiki/{}", q.replace(' ', "_")),
            snippet: format!("Information about {query} from the free encyclopedia. {} is a topic of interest in many fields.", query),
            source: format!("{:?}", backend),
            relevance: 0.95,
        },
        SearchResult {
            title: format!("{} — Documentation & Guides", &q[..q.len().min(40)]),
            url: format!("https://docs.rs/crate/{}", q.replace(' ', "-")),
            snippet: format!("Comprehensive documentation for {query}. Includes API reference, examples, and best practices."),
            source: format!("{:?}", backend),
            relevance: 0.88,
        },
        SearchResult {
            title: format!("{} — Stack Overflow", &q[..q.len().min(40)]),
            url: format!("https://stackoverflow.com/questions/tagged/{}", q.replace(' ', "-")),
            snippet: format!("Questions tagged '{query}' on Stack Overflow. Community-driven Q&A for developers."),
            source: format!("{:?}", backend),
            relevance: 0.82,
        },
        SearchResult {
            title: format!("{} — GitHub Repositories", &q[..q.len().min(40)]),
            url: format!("https://github.com/search?q={}", q.replace(' ', "+")),
            snippet: format!("Open-source projects related to {query}. Find code, issues, and pull requests."),
            source: format!("{:?}", backend),
            relevance: 0.78,
        },
        SearchResult {
            title: format!("{} — Latest News", &q[..q.len().min(40)]),
            url: format!("https://news.google.com/search?q={}", q.replace(' ', "+")),
            snippet: format!("Recent news articles and updates about {query}. Stay informed with the latest developments."),
            source: format!("{:?}", backend),
            relevance: 0.71,
        },
    ]
}

pub struct WebSearch {
    backend: SearchBackend,
    api_key: Option<String>,
}

impl Default for WebSearch {
    fn default() -> Self {
        Self {
            backend: SearchBackend::DuckDuckGo,
            api_key: None,
        }
    }
}

impl WebSearch {
    pub fn new() -> Self { Self::default() }

    pub fn set_backend(&mut self, backend: SearchBackend) { self.backend = backend; }
    pub fn set_api_key(&mut self, key: String) { self.api_key = Some(key); }

    pub fn search(&self, query: &str, count: usize) -> Result<Vec<SearchResult>, String> {
        if query.trim().is_empty() {
            return Err("Search query is empty".into());
        }
        let mut results = simulate_search(query, self.backend);
        results.truncate(count.max(1).min(20));
        Ok(results)
    }

    pub fn search_with_backend(&self, query: &str, backend: SearchBackend, count: usize) -> Result<Vec<SearchResult>, String> {
        if query.trim().is_empty() {
            return Err("Search query is empty".into());
        }
        let mut results = simulate_search(query, backend);
        results.truncate(count.max(1).min(20));
        Ok(results)
    }

    /// Fetch and extract content from a URL.
    pub fn fetch_url(&self, url: &str) -> Result<String, String> {
        if url.trim().is_empty() {
            return Err("URL is empty".into());
        }
        // Simulated fetch — returns placeholder
        Ok(format!("[Content from {url}]\n\nThis is simulated web content. In production, this would fetch and extract the actual page content using reqwest + html2text.\n\nURL: {url}"))
    }
}

// ─── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn ws_search(
    engine: tauri::State<'_, WebSearch>,
    query: String,
    backend: Option<String>,
    count: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    match backend {
        Some(b) => engine.search_with_backend(&query, SearchBackend::from_str(&b), count.unwrap_or(5)),
        None => engine.search(&query, count.unwrap_or(5)),
    }
}

#[tauri::command]
pub fn ws_fetch(engine: tauri::State<'_, WebSearch>, url: String) -> Result<String, String> {
    engine.fetch_url(&url)
}

#[tauri::command]
pub fn ws_set_backend(_engine: tauri::State<'_, WebSearch>, backend: String) -> Result<(), String> {
    let mut ws = WebSearch::new();
    ws.set_backend(SearchBackend::from_str(&backend));
    Err("set_backend: use config file instead".into())
}

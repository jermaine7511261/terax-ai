import { useState } from "react";
import {
  wsSearch,
  wsFetch,
  wsSetBackend,
  type SearchResult,
  type SearchBackend,
} from "../lib/api";

const BACKENDS: SearchBackend[] = ["google", "bing", "duckduckgo", "searxng", "custom"];

export function WebSearchPanel() {
  const [query, setQuery] = useState("");
  const [backend, setBackendState] = useState<SearchBackend>("google");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedContent, setFetchedContent] = useState<string | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await wsSearch(query.trim(), backend, 10);
      setResults(r);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFetch = async () => {
    if (!fetchUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const content = await wsFetch(fetchUrl.trim());
      setFetchedContent(content);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSetBackend = async (b: SearchBackend) => {
    await wsSetBackend(b);
    setBackendState(b);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <h2 className="font-medium text-sm mb-1">Web Search</h2>
        <div className="flex gap-1 mb-1">
          <select className="text-xs px-1 py-1 border rounded" value={backend}
            onChange={(e) => handleSetBackend(e.target.value as SearchBackend)}>
            {BACKENDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="flex gap-1">
          <input className="flex-1 px-2 py-1 border rounded text-xs" placeholder="Search query..."
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          <button className="px-2 py-1 bg-blue-500 text-white rounded text-xs disabled:opacity-50"
            onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? "..." : "Search"}
          </button>
        </div>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}

      <div className="p-2 border-b flex gap-1 text-xs">
        <input className="flex-1 px-2 py-1 border rounded" placeholder="Fetch URL..."
          value={fetchUrl} onChange={(e) => setFetchUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()} />
        <button className="px-2 py-1 bg-purple-500 text-white rounded disabled:opacity-50"
          onClick={handleFetch} disabled={!fetchUrl.trim()}>Fetch</button>
      </div>

      {fetchedContent && (
        <div className="border-b max-h-24 overflow-auto">
          <div className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50">Fetched Content</div>
          <pre className="px-2 py-1 text-xs text-gray-700 whitespace-pre-wrap">{fetchedContent.slice(0, 500)}</pre>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {results.length === 0 && !loading && (
          <p className="text-gray-400 text-sm text-center mt-8">No results yet. Try a search.</p>
        )}
        {results.map((r, i) => (
          <div key={i} className="p-2 border-b hover:bg-gray-50">
            <a className="text-sm font-medium text-blue-600 truncate block" href={r.url} target="_blank" rel="noreferrer">
              {r.title}
            </a>
            <p className="text-xs text-gray-500 truncate">{r.url}</p>
            <p className="text-xs text-gray-700 mt-0.5">{r.snippet}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-400">{r.source}</span>
              <span className="text-xs text-gray-400">relevance: {(r.relevance * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

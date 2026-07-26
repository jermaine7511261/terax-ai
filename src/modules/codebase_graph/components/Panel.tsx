import { useEffect, useState, useCallback } from "react";
import {
  cgAll,
  cgSearch,
  cgReferences,
  cgStats,
  cgIndex,
  type SymbolEntry,
} from "../lib/api";

export function CodebaseGraphPanel() {
  const [symbols, setSymbols] = useState<SymbolEntry[]>([]);
  const [stats, setStats] = useState<[number, number, number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [refQuery, setRefQuery] = useState("");
  const [refResults, setRefResults] = useState<SymbolEntry[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, st] = await Promise.all([cgAll(), cgStats()]);
      setSymbols(s);
      setStats(st);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleIndex = async () => {
    setStatusMsg("Indexing...");
    try {
      await cgIndex();
      setStatusMsg("Index complete");
      await load();
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const r = await cgSearch(searchQuery.trim());
      setSymbols(r);
      setStatusMsg(`Found ${r.length} symbol(s)`);
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleReferences = async () => {
    if (!refQuery.trim()) return;
    try {
      const r = await cgReferences(refQuery.trim());
      setRefResults(r);
      setStatusMsg(`${r.length} reference(s) found`);
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading codebase graph...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Codebase Graph</h2>
        <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={handleIndex}>Index</button>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {statusMsg && (
        <div className="p-1 border-b text-xs text-blue-600 bg-blue-50">{statusMsg}</div>
      )}

      {stats && (
        <div className="p-2 border-b text-xs flex gap-3">
          <span>Symbols: <strong>{stats[0]}</strong></span>
          <span>Files: <strong>{stats[1]}</strong></span>
          <span>References: <strong>{stats[2]}</strong></span>
        </div>
      )}

      <div className="p-2 border-b space-y-1 text-xs">
        <div className="flex gap-1">
          <input className="flex-1 px-2 py-1 border rounded" placeholder="Search symbols..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
          <button className="px-2 py-1 bg-purple-500 text-white rounded" onClick={handleSearch}>Search</button>
        </div>
        <div className="flex gap-1">
          <input className="flex-1 px-2 py-1 border rounded" placeholder="Find references..."
            value={refQuery} onChange={(e) => setRefQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReferences()} />
          <button className="px-2 py-1 bg-yellow-500 text-white rounded" onClick={handleReferences}>Refs</button>
        </div>
      </div>

      {refResults.length > 0 && (
        <div className="border-b max-h-32 overflow-auto">
          <div className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50">References</div>
          {refResults.map((r) => (
            <div key={r.id} className="px-2 py-0.5 text-xs border-t">
              <span className="font-medium">{r.name}</span>
              <span className="text-gray-400"> in {r.file}:{r.line}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {symbols.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No symbols indexed. Click Index.</p>
        )}
        {symbols.map((s) => (
          <div key={s.id} className="px-2 py-1 border-b hover:bg-gray-50 text-xs">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-sm">{s.name}</span>
                <span className="text-gray-400 ml-1">{s.kind}</span>
                <span className="text-gray-400 ml-1">{s.file}:{s.line}:{s.column}</span>
                {s.parent && <span className="text-gray-400"> in {s.parent}</span>}
              </div>
              <span className="text-gray-400 ml-2 shrink-0">{s.references} refs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


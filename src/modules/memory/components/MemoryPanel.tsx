import { useState, useCallback } from "react";
import { searchMemories, searchSessions, type MemoryRecord, type SessionRecord } from "../lib/memoryApi";

type Tab = "memories" | "sessions";

export function MemoryPanel() {
  const [tab, setTab] = useState<Tab>("memories");
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      if (tab === "memories") {
        const r = await searchMemories(query);
        setMemories(r);
      } else {
        const r = await searchSessions(query);
        setSessions(r);
      }
    } finally {
      setLoading(false);
    }
  }, [query, tab]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-2 border-b">
        <button
          className={`px-3 py-1 rounded ${tab === "memories" ? "bg-blue-500 text-white" : "bg-gray-100"}`}
          onClick={() => setTab("memories")}
        >
          Memories
        </button>
        <button
          className={`px-3 py-1 rounded ${tab === "sessions" ? "bg-blue-500 text-white" : "bg-gray-100"}`}
          onClick={() => setTab("sessions")}
        >
          Sessions
        </button>
      </div>
      <div className="flex gap-2 p-2">
        <input
          className="flex-1 px-2 py-1 border rounded"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          className="px-3 py-1 bg-blue-500 text-white rounded disabled:opacity-50"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "..." : "Search"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {tab === "memories"
          ? memories.map((m) => (
              <div key={m.id} className="mb-2 p-2 bg-gray-50 rounded">
                <p className="text-sm">{m.content}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {m.tags} &middot; {m.created_at}
                </p>
              </div>
            ))
          : sessions.map((s) => (
              <div key={s.id} className="mb-2 p-2 bg-gray-50 rounded">
                <p className="font-medium text-sm">{s.title}</p>
                <p className="text-xs text-gray-500">{s.summary}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {s.model_id} &middot; {s.created_at}
                </p>
              </div>
            ))}
        {!loading && ((tab === "memories" && memories.length === 0) || (tab === "sessions" && sessions.length === 0)) && (
          <p className="text-gray-400 text-sm text-center mt-8">
            {query ? "No results found" : "Search above to find memories"}
          </p>
        )}
      </div>
    </div>
  );
}

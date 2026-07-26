import { useEffect, useState, useCallback } from "react";
import {
  hunkRecord,
  hunkList,
  hunkApply,
  hunkDelete,
  hunkCleanup,
  type Hunk,
} from "../lib/api";

export function HunkerPanel() {
  const [hunks, setHunks] = useState<Hunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [file, setFile] = useState("");
  const [oldStart, setOldStart] = useState(1);
  const [newStart, setNewStart] = useState(1);
  const [content, setContent] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await hunkList();
      setHunks(h);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRecord = async () => {
    if (!file.trim() || !content.trim()) return;
    try {
      await hunkRecord(file.trim(), oldStart, newStart, content);
      setFile(""); setContent(""); setOldStart(1); setNewStart(1);
      setShowAdd(false);
      setStatusMsg("Hunk recorded");
      await load();
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleApply = async (id: string) => {
    try {
      await hunkApply(id);
      setStatusMsg("Hunk applied");
      await load();
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleDelete = async (id: string) => {
    await hunkDelete(id);
    await load();
  };

  const handleCleanup = async () => {
    const count = await hunkCleanup();
    setStatusMsg(`Cleaned up ${count} committed hunks`);
    await load();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading hunks...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Hunk Tracker</h2>
        <div className="flex gap-1">
          <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
            onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? "Cancel" : "+ Hunk"}
          </button>
          <button className="text-xs px-2 py-1 bg-yellow-500 text-white rounded"
            onClick={handleCleanup}>Cleanup</button>
        </div>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {statusMsg && (
        <div className="p-1 border-b text-xs text-blue-600 bg-blue-50">{statusMsg}</div>
      )}

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="File path"
            value={file} onChange={(e) => setFile(e.target.value)} />
          <div className="flex gap-1">
            <input className="flex-1 px-2 py-1 border rounded" type="number" placeholder="Old start line"
              value={oldStart} onChange={(e) => setOldStart(Number(e.target.value))} />
            <input className="flex-1 px-2 py-1 border rounded" type="number" placeholder="New start line"
              value={newStart} onChange={(e) => setNewStart(Number(e.target.value))} />
          </div>
          <textarea className="w-full px-2 py-1 border rounded font-mono" rows={4} placeholder="Diff content..."
            value={content} onChange={(e) => setContent(e.target.value)} />
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleRecord}>
            Record Hunk
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {hunks.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No hunks recorded.</p>
        )}
        {hunks.map((h) => (
          <div key={h.id} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${h.committed ? "bg-gray-400" : "bg-green-500"}`} />
                  <p className="text-sm font-medium truncate">{h.file}</p>
                  {h.committed && <span className="text-xs text-gray-400">committed</span>}
                </div>
                <p className="text-xs text-gray-500">
                  @@ -{h.old_start},{h.old_lines} +{h.new_start},{h.new_lines} @@
                </p>
                <pre className="text-xs text-gray-600 truncate mt-0.5 font-mono">{h.content.slice(0, 120)}</pre>
              </div>
              {!h.committed && (
                <div className="flex gap-1 ml-2 shrink-0">
                  <button className="text-xs text-blue-500 hover:underline"
                    onClick={() => handleApply(h.id)}>Apply</button>
                  <button className="text-xs text-red-500 hover:underline"
                    onClick={() => handleDelete(h.id)}>Del</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

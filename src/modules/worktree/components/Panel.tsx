import { useEffect, useState, useCallback } from "react";
import { wtSnapshot, wtDiff, wtPending, wtClear, type FileChange } from "../lib/api";

export function WorktreePanel() {
  const [pending, setPending] = useState<FileChange[]>([]);
  const [diff, setDiff] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await wtPending();
      setPending(p);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSnapshot = async () => {
    try {
      const count = await wtSnapshot();
      setStatusMsg(`Snapshot created: ${count} files`);
      await load();
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleDiff = async () => {
    try {
      const d = await wtDiff();
      setDiff(d);
      setStatusMsg(`Diff: ${d.length} change(s)`);
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleClear = async () => {
    await wtClear();
    setPending([]);
    setStatusMsg("Cleared");
  };

  const colorKind = (k: string) =>
    k === "Created" ? "text-green-500" :
    k === "Deleted" ? "text-red-500" : "text-yellow-500";

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading worktree...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Worktree</h2>
        <div className="flex gap-1">
          <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded" onClick={handleSnapshot}>Snapshot</button>
          <button className="text-xs px-2 py-1 bg-yellow-500 text-white rounded" onClick={handleDiff}>Diff</button>
          <button className="text-xs px-2 py-1 bg-red-500 text-white rounded" onClick={handleClear}>Clear</button>
        </div>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {statusMsg && <div className="p-1 border-b text-xs text-blue-600 bg-blue-50">{statusMsg}</div>}

      {diff.length > 0 && (
        <div className="border-b max-h-40 overflow-auto">
          <div className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50">Recent Diff</div>
          {diff.map((d, i) => (
            <div key={i} className="px-2 py-0.5 border-t text-xs flex items-center">
              <span className={`font-medium w-16 shrink-0 ${colorKind(d.kind)}`}>{d.kind}</span>
              <span className="text-gray-700 truncate flex-1 ml-1">{d.path}</span>
              <span className="text-gray-400 ml-2 shrink-0">{(d.size_bytes / 1024).toFixed(1)} KB</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50 sticky top-0">
          Pending ({pending.length})
        </div>
        {pending.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">No pending changes.</p>
        ) : (
          pending.map((p, i) => (
            <div key={i} className="px-2 py-1 border-t text-xs flex items-center">
              <span className={`font-medium w-16 shrink-0 ${colorKind(p.kind)}`}>{p.kind}</span>
              <span className="text-gray-700 truncate flex-1 ml-1">{p.path}</span>
              <span className="text-gray-400 ml-2 shrink-0">{(p.size_bytes / 1024).toFixed(1)} KB</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

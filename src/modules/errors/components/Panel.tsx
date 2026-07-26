import { useEffect, useState, useCallback } from "react";
import {
  errorsClassify,
  errorsStats,
  errorsRecent,
  errorsMarkRecovered,
  errorsAutoFix,
  type ClassifiedError,
  type ErrorStats,
} from "../lib/api";

export function ErrorsPanel() {
  const [errors, setErrors] = useState<ClassifiedError[]>([]);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classifyInput, setClassifyInput] = useState("");
  const [classifyResult, setClassifyResult] = useState<string | null>(null);
  const [autoFixResult, setAutoFixResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, s] = await Promise.all([errorsRecent(50), errorsStats()]);
      setErrors(e);
      setStats(s);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClassify = async () => {
    if (!classifyInput.trim()) return;
    try {
      const r = await errorsClassify(classifyInput.trim());
      setClassifyResult(`[${r.category}] ${r.raw_message.slice(0, 100)}${r.recovered ? " (recovered)" : ""}`);
    } catch (e: unknown) {
      setClassifyResult(`Error: ${String(e)}`);
    }
  };

  const handleMarkRecovered = async (id: string) => {
    await errorsMarkRecovered(id);
    await load();
  };

  const handleAutoFix = async (id: string) => {
    try {
      const result = await errorsAutoFix(id);
      setAutoFixResult(result);
    } catch (e: unknown) {
      setAutoFixResult(`Error: ${String(e)}`);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading error classifier...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <h2 className="font-medium text-sm mb-1">Error Classifier</h2>
        <div className="flex gap-1">
          <input className="flex-1 px-2 py-1 border rounded text-xs" placeholder="Classify an error message..."
            value={classifyInput} onChange={(e) => setClassifyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleClassify()} />
          <button className="px-2 py-1 bg-blue-500 text-white rounded text-xs disabled:opacity-50"
            onClick={handleClassify} disabled={!classifyInput.trim()}>Classify</button>
        </div>
        {classifyResult && (
          <p className="text-xs text-blue-600 mt-1">{classifyResult}</p>
        )}
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {autoFixResult && (
        <div className="p-2 bg-green-50 border-b text-xs text-green-700">{autoFixResult}</div>
      )}

      {stats && (
        <div className="p-2 border-b text-xs flex gap-2 flex-wrap">
          <span>Total: <strong>{stats.total}</strong></span>
          <span className="text-green-500">Recovered: <strong>{stats.recovered}</strong></span>
          <span className="text-red-500">Unresolved: <strong>{stats.unresolved}</strong></span>
          {Object.entries(stats.by_category).map(([cat, count]) => (
            <span key={cat} className="text-gray-500">{cat}: <strong>{count}</strong></span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {errors.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No errors recorded.</p>
        )}
        {errors.map((e) => (
          <div key={e.id} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-1 rounded ${
                    e.category === "auth" ? "bg-red-100 text-red-700" :
                    e.category === "rate_limit" ? "bg-yellow-100 text-yellow-700" :
                    e.category === "timeout" ? "bg-orange-100 text-orange-700" :
                    e.category === "network" ? "bg-purple-100 text-purple-700" :
                    "bg-gray-100 text-gray-700"
                  }`}>{e.category}</span>
                  {e.recovered && <span className="text-xs text-green-500">Recovered</span>}
                  <span className="text-xs text-gray-400 ml-auto">
                    {new Date(e.timestamp).toLocaleString()} &middot; x{e.frequency}
                  </span>
                </div>
                <p className="text-xs text-gray-700 truncate mt-0.5">{e.raw_message}</p>
                {e.source && <p className="text-xs text-gray-400">Source: {e.source}</p>}
                {e.recovery_action && (
                  <p className="text-xs text-green-600">Recovery: {e.recovery_action}</p>
                )}
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                {!e.recovered && (
                  <button className="text-xs text-green-500 hover:underline"
                    onClick={() => handleMarkRecovered(e.id)}>Recover</button>
                )}
                <button className="text-xs text-blue-500 hover:underline"
                  onClick={() => handleAutoFix(e.id)}>Auto-fix</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

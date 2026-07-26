import { useEffect, useState, useCallback } from "react";
import {
  cbList,
  cbRegister,
  cbCallAllowed,
  cbRecordSuccess,
  cbRecordFailure,
  cbReset,
  type CircuitBreaker,
} from "../lib/api";

export function CircuitPanel() {
  const [breakers, setBreakers] = useState<CircuitBreaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(5);
  const [timeoutSecs, setTimeoutSecs] = useState(30);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await cbList();
      setBreakers(b);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRegister = async () => {
    if (!name.trim()) return;
    await cbRegister(name.trim(), threshold, timeoutSecs);
    setName("");
    setShowAdd(false);
    setStatusMsg(`Registered ${name}`);
    await load();
  };

  const handleCheck = async (breakerName: string) => {
    try {
      const allowed = await cbCallAllowed(breakerName);
      setStatusMsg(`${breakerName}: ${allowed ? "Allowed" : "BLOCKED (circuit open)"}`);
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    }
  };

  const handleSuccess = async (breakerName: string) => {
    await cbRecordSuccess(breakerName);
    setStatusMsg(`${breakerName}: success recorded`);
    await load();
  };

  const handleFailure = async (breakerName: string) => {
    await cbRecordFailure(breakerName);
    setStatusMsg(`${breakerName}: failure recorded`);
    await load();
  };

  const handleReset = async (breakerName: string) => {
    await cbReset(breakerName);
    setStatusMsg(`${breakerName}: reset`);
    await load();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading circuit breakers...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Circuit Board</h2>
        <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ New"}
        </button>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {statusMsg && (
        <div className="p-1 border-b text-xs text-blue-600 bg-blue-50">{statusMsg}</div>
      )}

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Breaker name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-1">
            <input className="flex-1 px-2 py-1 border rounded" type="number" placeholder="Failure threshold"
              value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            <input className="flex-1 px-2 py-1 border rounded" type="number" placeholder="Timeout (sec)"
              value={timeoutSecs} onChange={(e) => setTimeoutSecs(Number(e.target.value))} />
          </div>
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleRegister}>
            Register Breaker
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {breakers.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No circuit breakers registered.</p>
        )}
        {breakers.map((b) => (
          <div key={b.name} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    b.state === "closed" ? "bg-green-500" :
                    b.state === "open" ? "bg-red-500" : "bg-yellow-500"
                  }`} />
                  <p className="text-sm font-medium truncate">{b.name}</p>
                  <span className={`text-xs font-medium px-1 rounded ${
                    b.state === "closed" ? "bg-green-100 text-green-700" :
                    b.state === "open" ? "bg-red-100 text-red-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>{b.state}</span>
                </div>
                <p className="text-xs text-gray-500">
                  Failures: {b.failure_count}/{b.threshold} &middot; Successes: {b.success_count}
                  &middot; Timeout: {b.timeout_secs}s
                </p>
                {b.last_failure && (
                  <p className="text-xs text-red-400">Last failure: {new Date(b.last_failure).toLocaleString()}</p>
                )}
                {b.opened_at && (
                  <p className="text-xs text-red-500">Opened: {new Date(b.opened_at).toLocaleString()}</p>
                )}
              </div>
              <div className="flex gap-1 ml-2 shrink-0 flex-wrap">
                <button className="text-xs text-blue-500 hover:underline"
                  onClick={() => handleCheck(b.name)}>Check</button>
                <button className="text-xs text-green-500 hover:underline"
                  onClick={() => handleSuccess(b.name)}>OK</button>
                <button className="text-xs text-red-500 hover:underline"
                  onClick={() => handleFailure(b.name)}>Fail</button>
                <button className="text-xs text-yellow-500 hover:underline"
                  onClick={() => handleReset(b.name)}>Reset</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

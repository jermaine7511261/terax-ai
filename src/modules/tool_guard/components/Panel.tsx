import { useEffect, useState, useCallback } from "react";
import {
  guardListRules,
  guardAddRule,
  guardRemoveRule,
  guardToggleRule,
  guardStats,
  guardCheck,
  type GuardRule,
  type GuardAction,
  type GuardStats as GuardStatsType,
} from "../lib/api";

const ACTIONS: GuardAction[] = ["allow", "deny", "warn", "require_approval"];

const EMPTY_RULE: GuardRule = {
  id: "", tool_pattern: "", resource_pattern: "", action: "deny",
  reason: "", severity: 5, enabled: true,
};

export function ToolGuardPanel() {
  const [rules, setRules] = useState<GuardRule[]>([]);
  const [stats, setStats] = useState<GuardStatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<GuardRule>({ ...EMPTY_RULE });
  const [checkTool, setCheckTool] = useState("");
  const [checkResource, setCheckResource] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([guardListRules(), guardStats()]);
      setRules(r);
      setStats(s);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.tool_pattern.trim()) return;
    const rule: GuardRule = {
      ...form,
      id: `gr-${Date.now().toString(36)}`,
      tool_pattern: form.tool_pattern.trim(),
    };
    await guardAddRule(rule);
    setForm({ ...EMPTY_RULE });
    setShowAdd(false);
    await load();
  };

  const handleRemove = async (id: string) => {
    await guardRemoveRule(id);
    await load();
  };

  const handleToggle = async (id: string) => {
    await guardToggleRule(id);
    await load();
  };

  const handleCheck = async () => {
    if (!checkTool.trim()) return;
    try {
      const r = await guardCheck(checkTool.trim(), checkResource.trim());
      setCheckResult(`${r.allowed ? "ALLOWED" : "DENIED"}: ${r.reason} (action: ${r.action})`);
    } catch (e: unknown) {
      setCheckResult(`Error: ${String(e)}`);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading guard rules...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Tool Guard</h2>
        <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Rule"}
        </button>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}

      {stats && (
        <div className="p-2 border-b text-xs flex gap-3">
          <span>Checks: <strong>{stats.total_checks}</strong></span>
          <span className="text-red-500">Denied: <strong>{stats.denied_count}</strong></span>
          <span className="text-yellow-500">Warned: <strong>{stats.warned_count}</strong></span>
          <span className="text-green-500">Approved: <strong>{stats.approved_count}</strong></span>
          <span>Rules: <strong>{stats.active_rules}</strong></span>
        </div>
      )}

      <div className="p-2 border-b flex gap-1 text-xs">
        <input className="flex-1 px-2 py-1 border rounded" placeholder="Tool name..."
          value={checkTool} onChange={(e) => setCheckTool(e.target.value)} />
        <input className="flex-1 px-2 py-1 border rounded" placeholder="Resource..."
          value={checkResource} onChange={(e) => setCheckResource(e.target.value)} />
        <button className="px-2 py-1 bg-purple-500 text-white rounded disabled:opacity-50"
          onClick={handleCheck} disabled={!checkTool.trim()}>Check</button>
      </div>
      {checkResult && (
        <div className="px-2 py-1 border-b text-xs text-blue-700 bg-blue-50">{checkResult}</div>
      )}

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Tool pattern (e.g. fs:*)"
            value={form.tool_pattern} onChange={(e) => setForm({ ...form, tool_pattern: e.target.value })} />
          <input className="w-full px-2 py-1 border rounded" placeholder="Resource pattern (e.g. /etc/*)"
            value={form.resource_pattern} onChange={(e) => setForm({ ...form, resource_pattern: e.target.value })} />
          <select className="w-full px-2 py-1 border rounded" value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value as GuardAction })}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input className="w-full px-2 py-1 border rounded" placeholder="Reason"
            value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <input className="w-full px-2 py-1 border rounded" type="number" min="1" max="10" placeholder="Severity (1-10)"
            value={form.severity} onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })} />
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleAdd}>
            Add Rule
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {rules.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No guard rules defined.</p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${r.enabled ? "bg-green-500" : "bg-gray-400"}`} />
                  <p className="text-sm font-medium truncate">{r.tool_pattern}</p>
                  <span className={`text-xs px-1 rounded ${
                    r.action === "allow" ? "bg-green-100 text-green-700" :
                    r.action === "deny" ? "bg-red-100 text-red-700" :
                    r.action === "warn" ? "bg-yellow-100 text-yellow-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>{r.action}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{r.resource_pattern} &middot; {r.reason}</p>
              </div>
              <div className="flex gap-1 ml-2">
                <button className="text-xs text-yellow-500 hover:underline"
                  onClick={() => handleToggle(r.id)}>{r.enabled ? "Disable" : "Enable"}</button>
                <button className="text-xs text-red-500 hover:underline"
                  onClick={() => handleRemove(r.id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

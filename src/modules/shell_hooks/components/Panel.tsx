import { useEffect, useState, useCallback } from "react";
import {
  hooksList,
  hooksRegister,
  hooksUnregister,
  hooksRun,
  hooksToggle,
  type ShellHook,
  type HookType,
} from "../lib/api";

const HOOK_TYPES: HookType[] = ["pre_command", "post_command", "on_error", "on_startup", "on_shutdown"];

const EMPTY_HOOK: ShellHook = {
  id: "", name: "", hook_type: "pre_command", command: "",
  pattern: "", enabled: true, run_count: 0,
};

export function ShellHooksPanel() {
  const [hooks, setHooks] = useState<ShellHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<ShellHook>({ ...EMPTY_HOOK });
  const [runOutput, setRunOutput] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await hooksList();
      setHooks(h);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRegister = async () => {
    if (!form.name.trim() || !form.command.trim()) return;
    const hook: ShellHook = {
      ...form,
      id: `hook-${Date.now().toString(36)}`,
      name: form.name.trim(),
      command: form.command.trim(),
    };
    await hooksRegister(hook);
    setForm({ ...EMPTY_HOOK });
    setShowAdd(false);
    await load();
  };

  const handleUnregister = async (id: string) => {
    await hooksUnregister(id);
    await load();
  };

  const handleToggle = async (id: string) => {
    await hooksToggle(id);
    await load();
  };

  const handleRun = async (id: string) => {
    try {
      const output = await hooksRun(id);
      setRunOutput(output);
    } catch (e: unknown) {
      setRunOutput(`Error: ${String(e)}`);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading shell hooks...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Shell Hooks</h2>
        <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Hook"}
        </button>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {runOutput && (
        <div className="p-2 bg-blue-50 border-b text-xs">
          <p className="font-medium text-blue-700">Output:</p>
          <pre className="text-blue-600 whitespace-pre-wrap mt-0.5">{runOutput}</pre>
        </div>
      )}

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Hook name"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="w-full px-2 py-1 border rounded" value={form.hook_type}
            onChange={(e) => setForm({ ...form, hook_type: e.target.value as HookType })}>
            {HOOK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="w-full px-2 py-1 border rounded" placeholder="Command to run"
            value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
          <input className="w-full px-2 py-1 border rounded" placeholder="Pattern (e.g. *.rs)"
            value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleRegister}>
            Register Hook
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {hooks.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No hooks registered.</p>
        )}
        {hooks.map((h) => (
          <div key={h.id} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${h.enabled ? "bg-green-500" : "bg-gray-400"}`} />
                  <p className="text-sm font-medium truncate">{h.name}</p>
                  <span className="text-xs text-gray-400">{h.hook_type}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{h.command}</p>
                <p className="text-xs text-gray-400">Run count: {h.run_count} &middot; Pattern: {h.pattern}</p>
              </div>
              <div className="flex gap-1 ml-2">
                <button className="text-xs text-blue-500 hover:underline"
                  onClick={() => handleRun(h.id)}>Run</button>
                <button className="text-xs text-yellow-500 hover:underline"
                  onClick={() => handleToggle(h.id)}>{h.enabled ? "Disable" : "Enable"}</button>
                <button className="text-xs text-red-500 hover:underline"
                  onClick={() => handleUnregister(h.id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

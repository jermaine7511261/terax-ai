import { useEffect, useState, useCallback } from "react";
import {
  cpListSources,
  cpRegisterSource,
  cpRemoveSource,
  cpResolve,
  cpSetInMemory,
  cpInvalidate,
  type CredentialSource,
  type CredentialSourceType,
} from "../lib/api";

const EMPTY_SOURCE: CredentialSource = {
  id: "", provider: "", source_type: "env", priority: 0, is_active: true, last_error: null,
};

const SOURCE_TYPES: CredentialSourceType[] = ["env", "file", "keyring", "inline", "vault"];

export function CredentialPoolPanel() {
  const [sources, setSources] = useState<CredentialSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<CredentialSource>({ ...EMPTY_SOURCE });
  const [inlineKey, setInlineKey] = useState("");
  const [resolveResult, setResolveResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await cpListSources();
      setSources(s);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRegister = async () => {
    if (!form.provider.trim()) return;
    const source: CredentialSource = {
      ...form,
      id: `cp-${Date.now().toString(36)}`,
      provider: form.provider.trim(),
    };
    await cpRegisterSource(source);
    setForm({ ...EMPTY_SOURCE });
    setShowAdd(false);
    await load();
  };

  const handleRemove = async (id: string) => {
    await cpRemoveSource(id);
    await load();
  };

  const handleResolve = async (provider: string) => {
    try {
      const r = await cpResolve(provider);
      setResolveResult(`Resolved ${r.provider} from ${r.source_id}`);
    } catch (e: unknown) {
      setResolveResult(`Error: ${String(e)}`);
    }
  };

  const handleSetInline = async () => {
    if (!inlineKey.trim()) return;
    await cpSetInMemory("inline", inlineKey.trim());
    setInlineKey("");
    await load();
  };

  const handleInvalidate = async (provider: string) => {
    await cpInvalidate(provider);
    await load();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading credential sources...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Credential Pool</h2>
        <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {resolveResult && (
        <div className="p-2 bg-blue-50 border-b text-xs text-blue-700">{resolveResult}</div>
      )}

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Provider" value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          <select className="w-full px-2 py-1 border rounded" value={form.source_type}
            onChange={(e) => setForm({ ...form, source_type: e.target.value as CredentialSourceType })}>
            {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="w-full px-2 py-1 border rounded" type="number" placeholder="Priority" value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleRegister}>
            Register Source
          </button>
        </div>
      )}

      <div className="p-2 border-b space-y-1 text-xs">
        <div className="flex gap-1">
          <input className="flex-1 px-2 py-1 border rounded" placeholder="Set in-memory API key..."
            value={inlineKey} onChange={(e) => setInlineKey(e.target.value)} />
          <button className="px-2 py-1 bg-purple-500 text-white rounded disabled:opacity-50"
            onClick={handleSetInline} disabled={!inlineKey.trim()}>Set</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {sources.length === 0 && (
          <p className="text-gray-400 text-sm text-center mt-8">No credential sources registered.</p>
        )}
        {sources.map((s) => (
          <div key={s.id} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.is_active ? "bg-green-500" : "bg-red-400"}`} />
                  <p className="text-sm font-medium truncate">{s.provider}</p>
                  <span className="text-xs text-gray-400">{s.source_type}</span>
                </div>
                <p className="text-xs text-gray-500">Priority {s.priority}</p>
                {s.last_error && <p className="text-xs text-red-400 truncate">{s.last_error}</p>}
              </div>
              <div className="flex gap-1 ml-2">
                <button className="text-xs text-blue-500 hover:underline"
                  onClick={() => handleResolve(s.provider)}>Resolve</button>
                <button className="text-xs text-yellow-500 hover:underline"
                  onClick={() => handleInvalidate(s.provider)}>Invalidate</button>
                <button className="text-xs text-red-500 hover:underline"
                  onClick={() => handleRemove(s.id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

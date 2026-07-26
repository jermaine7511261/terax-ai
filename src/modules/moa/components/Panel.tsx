import { useEffect, useState, useCallback } from "react";
import {
  moaList,
  moaRegister,
  moaUnregister,
  moaSelect,
  type MoaModel,
  type MoaPlan,
} from "../lib/api";

const EMPTY_MODEL: MoaModel = {
  id: "", provider: "openai", model: "", priority: 0, weight: 1,
  capabilities: [], cost_per_1k: 0,
};

export function MoaPanel() {
  const [models, setModels] = useState<MoaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<MoaModel>({ ...EMPTY_MODEL });
  const [planResult, setPlanResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await moaList();
      setModels(m);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRegister = async () => {
    if (!form.model.trim() || !form.provider.trim()) return;
    const model: MoaModel = {
      ...form,
      id: `moa-${Date.now().toString(36)}`,
      model: form.model.trim(),
    };
    await moaRegister(model);
    setForm({ ...EMPTY_MODEL });
    setShowAdd(false);
    await load();
  };

  const handleUnregister = async (id: string) => {
    await moaUnregister(id);
    await load();
  };

  const handleSelect = async () => {
    try {
      const plan: MoaPlan = {
        models,
        strategy: { type: "aggregate" },
        max_parallel: 3,
        timeout_ms: 30000,
        aggregate_prompt: "Combine responses",
      };
      const result = await moaSelect(plan);
      setPlanResult(result);
    } catch (e: unknown) {
      setPlanResult(`Error: ${String(e)}`);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading MOA models...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">MOA Multi-Model</h2>
        <button
          className="text-xs px-2 py-1 bg-blue-500 text-white rounded disabled:opacity-50"
          onClick={() => setShowAdd(!showAdd)}
        >
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {error && (
        <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>
      )}

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Provider" value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          <input className="w-full px-2 py-1 border rounded" placeholder="Model name" value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <input className="w-full px-2 py-1 border rounded" type="number" placeholder="Priority" value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          <input className="w-full px-2 py-1 border rounded" type="number" step="0.1" placeholder="Weight" value={form.weight}
            onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
          <input className="w-full px-2 py-1 border rounded" type="number" step="0.001" placeholder="Cost per 1K tokens" value={form.cost_per_1k}
            onChange={(e) => setForm({ ...form, cost_per_1k: Number(e.target.value) })} />
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleRegister}>
            Register
          </button>
        </div>
      )}

      {models.length > 0 && (
        <div className="p-2 border-b">
          <button className="w-full text-xs px-2 py-1 bg-purple-500 text-white rounded" onClick={handleSelect}>
            Run Aggregate Select
          </button>
          {planResult && (
            <p className="text-xs text-gray-600 mt-1 truncate">{planResult}</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {models.length === 0 && !loading && (
          <p className="text-gray-400 text-sm text-center mt-8">No models registered.</p>
        )}
        {models.map((m) => (
          <div key={m.id} className="p-2 border-b hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{m.model}</p>
                <p className="text-xs text-gray-500">
                  {m.provider} &middot; priority {m.priority} &middot; weight {m.weight}
                  &middot; ${m.cost_per_1k}/1K
                </p>
              </div>
              <button className="text-xs text-red-500 hover:underline ml-2"
                onClick={() => handleUnregister(m.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


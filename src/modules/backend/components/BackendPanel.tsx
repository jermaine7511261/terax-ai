import { useEffect, useState, useCallback } from "react";
import {
  listBackends,
  registerBackend,
  removeBackend,
  backendStatusAll,
  type BackendConfig,
  type BackendStatus,
  type BackendKind,
} from "../lib/backendApi";

const INITIAL_CONFIG: BackendConfig = {
  id: "", name: "", kind: "Docker", host: null, port: null,
  user: null, identity_file: null, container: null, image: null,
  work_dir: null, env: null, enabled: true,
};

export function BackendPanel() {
  const [backends, setBackends] = useState<BackendConfig[]>([]);
  const [statuses, setStatuses] = useState<BackendStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<BackendConfig>({ ...INITIAL_CONFIG });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s] = await Promise.all([listBackends(), backendStatusAll()]);
      setBackends(b);
      setStatuses(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    const config: BackendConfig = {
      ...form,
      id: `be-${Date.now().toString(36)}`,
      name: form.name.trim(),
    };
    await registerBackend(config);
    setForm({ ...INITIAL_CONFIG });
    setShowAdd(false);
    await load();
  };

  const handleRemove = async (id: string) => {
    await removeBackend(id);
    await load();
  };

  const statusFor = (id: string): BackendStatus | undefined =>
    statuses.find((s) => s.id === id);

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading backends...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Remote Backends</h2>
        <button
          className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}
        >
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="w-full px-2 py-1 border rounded" value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as BackendKind })}>
            <option value="Docker">Docker</option>
            <option value="SSH">SSH</option>
          </select>
          {form.kind === "Docker" && (
            <input className="w-full px-2 py-1 border rounded" placeholder="Container name" value={form.container ?? ""}
              onChange={(e) => setForm({ ...form, container: e.target.value })} />
          )}
          {form.kind === "SSH" && (
            <>
              <input className="w-full px-2 py-1 border rounded" placeholder="Host" value={form.host ?? ""}
                onChange={(e) => setForm({ ...form, host: e.target.value })} />
              <input className="w-full px-2 py-1 border rounded" type="number" placeholder="Port (22)" value={form.port ?? ""}
                onChange={(e) => setForm({ ...form, port: e.target.value ? Number(e.target.value) : null })} />
              <input className="w-full px-2 py-1 border rounded" placeholder="User" value={form.user ?? ""}
                onChange={(e) => setForm({ ...form, user: e.target.value })} />
              <input className="w-full px-2 py-1 border rounded" placeholder="Identity file path" value={form.identity_file ?? ""}
                onChange={(e) => setForm({ ...form, identity_file: e.target.value })} />
            </>
          )}
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleAdd}>
            Register
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {backends.map((b) => {
          const st = statusFor(b.id);
          return (
            <div key={b.id} className="p-2 border-b hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${st?.connected ? "bg-green-500" : "bg-red-400"}`} />
                    <p className="text-sm font-medium truncate">{b.name}</p>
                    <span className="text-xs text-gray-400">{b.kind}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {b.kind === "Docker" && b.container && `Container: ${b.container}`}
                    {b.kind === "SSH" && b.host && `${b.user ?? "root"}@${b.host}:${b.port ?? 22}`}
                    {b.kind === "Local" && "Local machine"}
                  </p>
                  {st && !st.connected && st.error && (
                    <p className="text-xs text-red-400 truncate mt-0.5">{st.error}</p>
                  )}
                  {st?.latency_ms != null && (
                    <p className="text-xs text-gray-400">{st.latency_ms}ms</p>
                  )}
                </div>
                {b.id !== "local" && (
                  <button className="text-xs text-red-500 hover:underline ml-2"
                    onClick={() => handleRemove(b.id)}>Remove</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { listPlugins, togglePlugin, unregisterPlugin, collectPluginTools, type PluginInstance, type PluginToolDef } from "../lib/pluginApi";

export function PluginPanel() {
  const [plugins, setPlugins] = useState<PluginInstance[]>([]);
  const [tools, setTools] = useState<PluginToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PluginInstance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([listPlugins(), collectPluginTools()]);
      setPlugins(p);
      setTools(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selected) {
    const m = selected.manifest;
    return (
      <div className="flex flex-col h-full">
        <div className="p-2 border-b flex items-center gap-2">
          <button className="text-xs px-2 py-1 bg-gray-100 rounded" onClick={() => setSelected(null)}>&larr; Back</button>
          <h2 className="font-medium text-sm truncate">{m.name}</h2>
        </div>
        <div className="flex-1 overflow-auto p-3 text-xs space-y-2">
          <div><span className="text-gray-500">ID:</span> {m.id}</div>
          <div><span className="text-gray-500">Version:</span> {m.version}</div>
          <div><span className="text-gray-500">Author:</span> {m.author}</div>
          <div><span className="text-gray-500">License:</span> {m.license}</div>
          <div><span className="text-gray-500">Entry:</span> {m.entry}</div>
          <div><span className="text-gray-500">Status:</span> {selected.enabled ? "Enabled" : "Disabled"}</div>
          <div className="border-t pt-1">
            <p className="font-medium mb-1">Permissions</p>
            <div className="flex flex-wrap gap-1">
              {m.permissions.map((p) => <span key={p} className="px-1.5 py-0.5 bg-gray-100 rounded">{p}</span>)}
            </div>
          </div>
          <div className="border-t pt-1">
            <p className="font-medium mb-1">Hooks ({m.hooks.length})</p>
            <p className="text-gray-500">{m.hooks.join(", ") || "None"}</p>
          </div>
          {m.tools.length > 0 && (
            <div className="border-t pt-1">
              <p className="font-medium mb-1">Tools ({m.tools.length})</p>
              {m.tools.map((t, i) => <p key={i} className="text-gray-600">{t.name} — {t.description}</p>)}
            </div>
          )}
        </div>
        <div className="p-2 border-t flex gap-2">
          <button className="text-xs px-2 py-1 bg-yellow-500 text-white rounded"
            onClick={async () => { await togglePlugin(m.id, !selected.enabled); load(); }}>
            {selected.enabled ? "Disable" : "Enable"}
          </button>
          <button className="text-xs px-2 py-1 bg-red-500 text-white rounded"
            onClick={async () => { await unregisterPlugin(m.id); setSelected(null); load(); }}>
            Unregister
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Plugins</h2>
        <span className="text-xs text-gray-400">{plugins.length} loaded</span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-gray-400 text-xs text-center mt-8">Loading...</p>
        ) : plugins.length === 0 ? (
          <p className="text-gray-400 text-xs text-center mt-8">No plugins registered</p>
        ) : (
          plugins.map((p) => (
            <div key={p.manifest.id} className="p-2 border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(p)}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${p.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                    <p className="text-sm font-medium truncate">{p.manifest.name}</p>
                    <span className="text-xs text-gray-400">v{p.manifest.version}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{p.manifest.description}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {tools.length > 0 && (
        <div className="border-t">
          <div className="p-1.5 bg-gray-50 text-xs text-gray-500 font-medium">Available Tools ({tools.length})</div>
          {tools.map((t, i) => (
            <div key={i} className="px-2 py-1 text-xs text-gray-600 border-b">{t.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}

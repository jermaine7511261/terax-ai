import { useEffect, useState, useCallback } from "react";
import { searchHub, installSkill, uninstallSkill, listInstalled, toggleSkill, refreshIndex, type HubSkill, type InstalledSkill } from "../lib/hubApi";

export function SkillsHubMarketplace() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubSkill[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"browse" | "installed">("browse");
  const [selected, setSelected] = useState<HubSkill | InstalledSkill | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    try {
      const i = await listInstalled();
      setInstalled(i);
    } catch {}
  }, []);

  useEffect(() => { loadInstalled(); }, [loadInstalled]);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!query.trim()) {
        const r = await refreshIndex();
        setResults(r);
      } else {
        const r = await searchHub(query);
        setResults(r);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { handleSearch(); }, [handleSearch]);

  const handleInstall = async (skillId: string) => {
    setError(null);
    try {
      await installSkill(skillId);
      await loadInstalled();
    } catch (e) { setError(String(e)); }
  };

  const handleUninstall = async (id: string) => {
    setError(null);
    try {
      await uninstallSkill(id);
      if (selected?.id === id) setSelected(null);
      await loadInstalled();
    } catch (e) { setError(String(e)); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await toggleSkill(id, enabled);
    await loadInstalled();
  };

  const installedIds = new Set(installed.map((i) => i.id));

  if (selected) {
    const isHub = "installs" in selected;
    const s = selected as HubSkill & InstalledSkill;
    return (
      <div className="flex flex-col h-full">
        <div className="p-2 border-b flex items-center gap-2">
          <button className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
            onClick={() => setSelected(null)}>&larr; Back</button>
          <h2 className="font-medium text-sm truncate">{s.name}</h2>
          <span className="text-xs text-gray-400">v{s.version}</span>
        </div>
        <div className="flex-1 overflow-auto p-3 text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded">{s.category}</span>
            <span className="text-xs text-gray-500">by {s.author}</span>
            <span className="text-xs text-gray-400">License: {s.license}</span>
          </div>
          {isHub && (
            <div className="flex gap-3 text-xs text-gray-500">
              <span>{(s as HubSkill).rating.toFixed(1)} rating</span>
              <span>{(s as HubSkill).installs.toLocaleString()} installs</span>
            </div>
          )}
          <p className="text-gray-600">{s.description}</p>
          <div className="flex flex-wrap gap-1">
            {s.tags.map((t) => <span key={t} className="text-xs px-1.5 py-0.5 bg-gray-100 rounded">{t}</span>)}
          </div>
          <div className="border-t pt-2 mt-2">
            <p className="font-medium text-xs mb-1">Instructions</p>
            <pre className="text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap">{s.instructions}</pre>
          </div>
          {s.source_url && (
            <a className="text-xs text-blue-500 hover:underline block" href={s.source_url} target="_blank" rel="noreferrer">
              View source &rarr;
            </a>
          )}
        </div>
        <div className="p-2 border-t flex gap-2">
          {installedIds.has(s.id) ? (
            <>
              <button className="text-xs px-2 py-1 bg-yellow-500 text-white rounded"
                onClick={() => handleToggle(s.id, !installed.find((i) => i.id === s.id)?.enabled)}>
                {installed.find((i) => i.id === s.id)?.enabled ? "Disable" : "Enable"}
              </button>
              <button className="text-xs px-2 py-1 bg-red-500 text-white rounded"
                onClick={() => handleUninstall(s.id)}>Uninstall</button>
            </>
          ) : (
            <button className="text-xs px-3 py-1 bg-blue-500 text-white rounded"
              onClick={() => handleInstall(s.id)}>Install</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b">
        <button className={`flex-1 py-1.5 text-xs font-medium ${tab === "browse" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`}
          onClick={() => setTab("browse")}>Browse ({results.length})</button>
        <button className={`flex-1 py-1.5 text-xs font-medium ${tab === "installed" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`}
          onClick={() => setTab("installed")}>Installed ({installed.length})</button>
      </div>

      <div className="p-2 border-b">
        <input className="w-full px-2 py-1 border rounded text-xs" placeholder="Search skills..."
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {error && <div className="p-2 text-xs text-red-500 bg-red-50">{error}</div>}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-gray-400 text-xs text-center mt-8">Loading...</p>
        ) : tab === "browse" ? (
          results.length === 0 ? (
            <p className="text-gray-400 text-xs text-center mt-8">{query ? "No skills found" : "Type to search the skill marketplace"}</p>
          ) : (
            results.map((s) => (
              <div key={s.id} className="p-2 border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(s)}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <span className="text-xs text-gray-400">v{s.version}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{s.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{s.author}</span>
                      <span className="text-xs text-gray-400">&middot; {s.rating.toFixed(1)}</span>
                      <span className="text-xs text-gray-400">&middot; {s.installs.toLocaleString()} installs</span>
                    </div>
                  </div>
                  {installedIds.has(s.id) ? (
                    <span className="text-xs text-green-500 ml-2 whitespace-nowrap">Installed</span>
                  ) : (
                    <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded ml-2 whitespace-nowrap"
                      onClick={(e) => { e.stopPropagation(); handleInstall(s.id); }}>Install</button>
                  )}
                </div>
              </div>
            ))
          )
        ) : (
          installed.length === 0 ? (
            <p className="text-gray-400 text-xs text-center mt-8">No installed skills. Browse the marketplace to install.</p>
          ) : (
            installed.map((s) => (
              <div key={s.id} className="p-2 border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(s)}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${s.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <span className="text-xs text-gray-400">v{s.version}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{s.description}</p>
                    <p className="text-xs text-gray-400">Installed {new Date(s.installed_at).toLocaleDateString()}</p>
                  </div>
                  <button className="text-xs text-red-500 hover:underline ml-2"
                    onClick={(e) => { e.stopPropagation(); handleUninstall(s.id); }}>Remove</button>
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}

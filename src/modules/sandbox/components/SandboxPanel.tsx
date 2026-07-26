import { useEffect, useState, useCallback } from "react";
import { getSandboxConfig, setSandboxConfig, type SandboxConfig, type SandboxLevel } from "../lib/sandboxApi";

const LEVELS: { id: SandboxLevel; label: string; desc: string }[] = [
  { id: "Off", label: "Off", desc: "No restrictions" },
  { id: "Workspace", label: "Workspace", desc: "Restricted to workspace directory" },
  { id: "Strict", label: "Strict", desc: "Workspace + no network" },
  { id: "ReadOnly", label: "Read Only", desc: "No file mutations allowed" },
];

export function SandboxPanel() {
  const [config, setConfig] = useState<SandboxConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await getSandboxConfig();
      setConfig(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLevelChange = async (level: SandboxLevel) => {
    if (!config) return;
    setSaving(true);
    try {
      const updated: SandboxConfig = {
        ...config,
        level,
        allow_network: level === "Off" || level === "Workspace",
        allow_write: level !== "ReadOnly",
      };
      await setSandboxConfig(updated);
      setConfig(updated);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading sandbox config...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <h2 className="font-medium text-sm">Sandbox</h2>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            className={`w-full text-left p-2 rounded text-sm border ${
              config?.level === l.id
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "hover:bg-gray-50 border-gray-200"
            }`}
            onClick={() => handleLevelChange(l.id)}
            disabled={saving}
          >
            <p className="font-medium">{l.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">{l.desc}</p>
          </button>
        ))}
        {saving && <p className="text-xs text-gray-400 text-center">Saving...</p>}
      </div>
      {config && (
        <div className="p-2 border-t text-xs text-gray-400">
          Workspace: {config.workspace_dir ?? "Not set"}
        </div>
      )}
    </div>
  );
}

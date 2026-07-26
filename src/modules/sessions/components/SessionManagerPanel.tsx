import { useEffect, useState, useCallback } from "react";
import {
  listSessions, createSession, deleteSession, setActiveSession,
  getActiveSession, cleanupSessions,
  type AgentSession,
} from "../lib/sessionApi";

const STATUS_COLORS: Record<string, string> = {
  Idle: "bg-gray-400",
  Running: "bg-green-500",
  Paused: "bg-yellow-400",
  AwaitingApproval: "bg-blue-400",
  Completed: "bg-green-300",
  Error: "bg-red-500",
};

export function SessionManagerPanel() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState("build");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([listSessions(), getActiveSession()]);
      setSessions(s);
      setActiveId(a?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const session = await createSession(name.trim(), agentType, "", 50);
    setSessions((prev) => [session, ...prev]);
    setName("");
    setShowCreate(false);
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const handleSetActive = async (id: string) => {
    await setActiveSession(id);
    setActiveId(id);
  };

  const handleCleanup = async () => {
    const count = await cleanupSessions();
    if (count > 0) await load();
  };

  const statusBadge = (s: AgentSession) => {
    const color = STATUS_COLORS[typeof s.status === "string" ? s.status : "Idle"] ?? "bg-gray-400";
    const label = typeof s.status === "string" ? s.status : "Idle";
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${color.replace("bg-", "bg-opacity-20 text-").replace("-500", "-700").replace("-400", "-600").replace("-300", "-500")}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
        {label}
      </span>
    );
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading sessions...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Agent Sessions</h2>
        <div className="flex gap-1">
          <button className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
            onClick={handleCleanup} title="Cleanup stale sessions">Clean</button>
          <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
            onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Cancel" : "+ New"}</button>
        </div>
      </div>

      {showCreate && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Session name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <select className="w-full px-2 py-1 border rounded" value={agentType}
            onChange={(e) => setAgentType(e.target.value)}>
            <option value="build">Build (full access)</option>
            <option value="plan">Plan (read-only)</option>
            <option value="explore">Explore (sub-agent)</option>
          </select>
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded"
            onClick={handleCreate} disabled={!name.trim()}>Create</button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">
            No agent sessions. Create one to start.
          </p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`p-2 border-b hover:bg-gray-50 cursor-pointer ${
                activeId === s.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
              }`}
              onClick={() => handleSetActive(s.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 mr-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    {statusBadge(s)}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.agent_type} &middot; {s.model_id || "default model"}
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {s.progress} &middot; {s.step_count}/{s.max_steps} steps
                    {s.input_tokens > 0 && ` &middot; ${s.input_tokens + s.output_tokens} tokens`}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(s.tool_counts).slice(0, 5).map(([tool, count]) => (
                      <span key={tool} className="text-xs px-1 bg-gray-100 rounded">
                        {tool}: {count}
                      </span>
                    ))}
                  </div>
                  {s.error && <p className="text-xs text-red-500 mt-0.5">{s.error}</p>}
                </div>
                <button
                  className="text-xs text-red-500 hover:underline whitespace-nowrap"
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                >
                  Del
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-2 text-xs text-gray-400 border-t flex justify-between">
        <span>{sessions.length} session(s)</span>
        <span>Active: {activeId ? sessions.find((s) => s.id === activeId)?.name ?? "unknown" : "none"}</span>
      </div>
    </div>
  );
}

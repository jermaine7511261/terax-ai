import { useState, useEffect, useCallback } from "react";
import { useCollaborationStore, type ShareSession } from "../lib/collaborationStore";
import {
  listWorkspaces,
  saveWorkspace,
  deleteWorkspace,
  getWorkspaceSessions,
  type TeamWorkspace,
  type SharedSession,
} from "../lib/workspaceApi";

type Tab = "share" | "workspaces";

export function CollaborationPanel() {
  const { sharedSessions, addSharedSession } = useCollaborationStore();
  const [tab, setTab] = useState<Tab>("share");
  const [sessionTitle, setSessionTitle] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Workspace state
  const [workspaces, setWorkspaces] = useState<TeamWorkspace[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [wsSessions, setWsSessions] = useState<SharedSession[]>([]);
  const [wsName, setWsName] = useState("");
  const [wsDesc, setWsDesc] = useState("");
  const [showCreateWs, setShowCreateWs] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const ws = await listWorkspaces();
    setWorkspaces(ws);
  }, []);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  const loadWsSessions = useCallback(async (wsId: string) => {
    const sessions = await getWorkspaceSessions(wsId);
    setWsSessions(sessions);
  }, []);

  useEffect(() => {
    if (selectedWs) loadWsSessions(selectedWs);
  }, [selectedWs, loadWsSessions]);

  const handleShare = () => {
    if (!sessionTitle.trim()) return;
    const newSession: ShareSession = {
      id: `share-${Date.now().toString(36)}`,
      title: sessionTitle.trim(),
      createdAt: new Date().toISOString(),
      shareUrl: `${window.location.origin}/share/${Date.now().toString(36)}`,
    };
    addSharedSession(newSession);
    setSessionTitle("");
  };

  const handleCopyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateWorkspace = async () => {
    if (!wsName.trim()) return;
    const ws: TeamWorkspace = {
      id: `ws-${Date.now().toString(36)}`,
      name: wsName.trim(),
      description: wsDesc.trim(),
      members: [],
      created_at: new Date().toISOString(),
      session_ids: [],
    };
    await saveWorkspace(ws);
    setWsName("");
    setWsDesc("");
    setShowCreateWs(false);
    await loadWorkspaces();
  };

  const handleDeleteWorkspace = async (id: string) => {
    await deleteWorkspace(id);
    if (selectedWs === id) setSelectedWs(null);
    await loadWorkspaces();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b">
        <button
          className={`flex-1 py-1.5 text-xs font-medium ${tab === "share" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`}
          onClick={() => setTab("share")}
        >
          Share
        </button>
        <button
          className={`flex-1 py-1.5 text-xs font-medium ${tab === "workspaces" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`}
          onClick={() => setTab("workspaces")}
        >
          Workspaces
        </button>
      </div>

      {tab === "share" ? (
        <>
          <div className="p-2 border-b">
            <h2 className="font-medium text-sm mb-1">Share Session</h2>
            <div className="flex gap-2">
              <input
                className="flex-1 px-2 py-1 border rounded text-sm"
                placeholder="Session title..."
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleShare()}
              />
              <button
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm disabled:opacity-50"
                onClick={handleShare}
                disabled={!sessionTitle.trim()}
              >
                Share
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {sharedSessions.length === 0 ? (
              <p className="text-gray-400 text-sm text-center mt-8">No shared sessions yet</p>
            ) : (
              sharedSessions.map((s) => (
                <div key={s.id} className="p-2 border-b hover:bg-gray-50">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-gray-400">{new Date(s.createdAt).toLocaleString()}</p>
                  {s.shareUrl && (
                    <button
                      className="text-xs text-blue-500 mt-1 hover:underline"
                      onClick={() => handleCopyLink(s.shareUrl!, s.id)}
                    >
                      {copiedId === s.id ? "Copied!" : "Copy share link"}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div className="p-2 border-b flex items-center justify-between">
            <h2 className="font-medium text-sm">Team Workspaces</h2>
            <button
              className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
              onClick={() => setShowCreateWs(!showCreateWs)}
            >
              {showCreateWs ? "Cancel" : "New"}
            </button>
          </div>

          {showCreateWs && (
            <div className="p-2 border-b space-y-1 text-xs">
              <input className="w-full px-2 py-1 border rounded" placeholder="Workspace name" value={wsName}
                onChange={(e) => setWsName(e.target.value)} />
              <input className="w-full px-2 py-1 border rounded" placeholder="Description" value={wsDesc}
                onChange={(e) => setWsDesc(e.target.value)} />
              <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleCreateWorkspace}>
                Create
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {selectedWs ? (
              <>
                <div className="p-2 bg-gray-50 border-b flex items-center gap-2">
                  <button className="text-xs px-2 py-0.5 bg-white border rounded" onClick={() => setSelectedWs(null)}>
                    &larr;
                  </button>
                  <span className="text-sm font-medium">{workspaces.find((w) => w.id === selectedWs)?.name}</span>
                </div>
                {wsSessions.length === 0 ? (
                  <p className="text-gray-400 text-xs text-center mt-4">No sessions shared to this workspace</p>
                ) : (
                  wsSessions.map((s) => (
                    <div key={s.id} className="p-2 border-b">
                      <p className="text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-gray-500">{s.summary}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        By {s.shared_by} &middot; {new Date(s.shared_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </>
            ) : (
              workspaces.length === 0 ? (
                <p className="text-gray-400 text-sm text-center mt-8">No workspaces yet</p>
              ) : (
                workspaces.map((ws) => (
                  <div key={ws.id} className="p-2 border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedWs(ws.id)}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{ws.name}</p>
                        <p className="text-xs text-gray-500">{ws.description || "No description"}</p>
                        <p className="text-xs text-gray-400">{ws.members.length} member(s)</p>
                      </div>
                      <button className="text-xs text-red-500 hover:underline" onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws.id); }}>
                        Del
                      </button>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

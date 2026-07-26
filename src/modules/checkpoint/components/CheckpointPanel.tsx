import { useEffect, useState, useCallback } from "react";
import {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  deleteCheckpoint,
  type Checkpoint,
} from "../lib/checkpointApi";

export function CheckpointPanel() {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await listCheckpoints();
      setCheckpoints(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!label.trim()) return;
    await createCheckpoint(label.trim());
    setLabel("");
    await load();
  };

  const handleRestore = async (id: string) => {
    setRestoring(id);
    try {
      const count = await restoreCheckpoint(id);
      alert(`Restored ${count} files from checkpoint`);
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteCheckpoint(id);
    await load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <h2 className="font-medium text-sm mb-1">Checkpoints</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 px-2 py-1 border rounded text-xs"
            placeholder="Checkpoint label..."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button
            className="px-2 py-1 bg-blue-500 text-white rounded text-xs disabled:opacity-50"
            onClick={handleCreate}
            disabled={!label.trim()}
          >
            Save
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-gray-400 text-sm text-center mt-8">Loading...</p>
        ) : checkpoints.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">
            No checkpoints yet. Save one above.
          </p>
        ) : (
          checkpoints.map((cp) => (
            <div key={cp.id} className="p-2 border-b hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{cp.label}</p>
                  <p className="text-xs text-gray-500">
                    {cp.file_count} file(s) &middot; {new Date(cp.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-1 ml-2">
                  <button
                    className="text-xs px-2 py-1 bg-yellow-500 text-white rounded disabled:opacity-50"
                    onClick={() => handleRestore(cp.id)}
                    disabled={restoring === cp.id}
                  >
                    {restoring === cp.id ? "..." : "Restore"}
                  </button>
                  <button
                    className="text-xs px-2 py-1 bg-red-500 text-white rounded"
                    onClick={() => handleDelete(cp.id)}
                  >
                    Del
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="p-2 text-xs text-gray-400 border-t">
        Max 20 checkpoints &middot; Restore overwrites current files
      </div>
    </div>
  );
}

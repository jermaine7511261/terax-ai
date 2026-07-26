import { useEffect } from "react";
import { useSnapshotStore } from "../lib/snapshotStore";

export function SnapshotPanel() {
  const { snapshots, loading, loadSnapshots, createSnapshot, deleteSnapshot } = useSnapshotStore();
  useEffect(() => { loadSnapshots(); }, []);

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Memory Snapshots</h2>
        <button className="px-3 py-1 bg-emerald-600 text-white rounded text-sm"
          onClick={() => {
            const label = prompt("Snapshot label:") || `snapshot-${Date.now()}`;
            createSnapshot(label, 0, 0, 0);
          }}>+ Freeze</button>
      </div>
      {loading ? <div className="text-gray-400">Loading...</div> : snapshots.length === 0 ? (
        <div className="text-gray-500 text-sm">No snapshots. Freeze memory state for later restoration.</div>
      ) : (
        snapshots.map((s) => (
          <div key={s.id} className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.label}</span>
              <button className="text-xs text-red-400" onClick={() => deleteSnapshot(s.id)}>Delete</button>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {s.memory_count} memories · {s.session_count} sessions · {s.skill_count} skills
            </div>
            <div className="text-xs text-gray-500">{s.created_at}</div>
          </div>
        ))
      )}
    </div>
  );
}

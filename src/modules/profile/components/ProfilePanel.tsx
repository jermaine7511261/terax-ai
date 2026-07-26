import { useEffect } from "react";
import { useProfileStore } from "../lib/profileStore";

export function ProfilePanel() {
  const { profile, loading, loadProfile, updateProfile, recordGoal } = useProfileStore();
  useEffect(() => { loadProfile(); }, []);

  if (loading || !profile) return <div className="p-4 text-gray-400">Loading profile...</div>;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
      <h2 className="text-lg font-semibold">User Profile</h2>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <span className="text-gray-400">Name:</span>
        <input className="bg-gray-800 rounded px-2 py-1" value={profile.name}
          onChange={(e) => updateProfile({ ...profile, name: e.target.value })} />
        <span className="text-gray-400">Role:</span>
        <input className="bg-gray-800 rounded px-2 py-1" value={profile.role}
          onChange={(e) => updateProfile({ ...profile, role: e.target.value })} />
        <span className="text-gray-400">Model:</span>
        <input className="bg-gray-800 rounded px-2 py-1" value={profile.model_preference}
          onChange={(e) => updateProfile({ ...profile, model_preference: e.target.value })} />
        <span className="text-gray-400">Agent Mode:</span>
        <span className="text-emerald-400">{profile.agent_mode}</span>
      </div>

      <div className="flex gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={profile.learning_enabled}
            onChange={(e) => updateProfile({ ...profile, learning_enabled: e.target.checked })} />
          Learning
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={profile.memory_enabled}
            onChange={(e) => updateProfile({ ...profile, memory_enabled: e.target.checked })} />
          Memory
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={profile.skill_auto_create}
            onChange={(e) => updateProfile({ ...profile, skill_auto_create: e.target.checked })} />
          Auto Skills
        </label>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Traits ({profile.traits.length})</h3>
        {profile.traits.map((t, i) => (
          <div key={i} className="text-xs bg-gray-800 rounded p-2 mb-1">
            <span className="text-emerald-400">{t.name}</span>
            <span className="text-gray-500 ml-2">({(t.confidence * 100).toFixed(0)}%)</span>
            <div className="text-gray-400 mt-1">{t.evidence}</div>
          </div>
        ))}
        {profile.traits.length === 0 && <div className="text-xs text-gray-500">No traits observed yet.</div>}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Recent Goals</h3>
        <div className="flex gap-2 mb-2">
          <input className="flex-1 bg-gray-800 rounded px-2 py-1 text-sm" placeholder="Add a goal..."
            onKeyDown={(e) => { if (e.key === "Enter") { recordGoal((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ""; }}} />
        </div>
        {profile.recent_goals.map((g, i) => (
          <div key={i} className="text-xs text-gray-300 py-0.5">• {g}</div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { listSkills, deleteSkill, useSkill, type SkillDef } from "../lib/skillsApi";

export function SkillsHub() {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<SkillDef | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listSkills();
      setSkills(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.description.toLowerCase().includes(filter.toLowerCase()) ||
          s.category.toLowerCase().includes(filter.toLowerCase()),
      )
    : skills;

  const handleDelete = async (id: string) => {
    await deleteSkill(id);
    await load();
  };

  const handleUse = async (id: string) => {
    await useSkill(id);
  };

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-2 border-b flex items-center gap-2">
          <button
            className="px-2 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
            onClick={() => setSelected(null)}
          >
            &larr; Back
          </button>
          <h2 className="font-medium">{selected.name}</h2>
          <span className="text-xs text-gray-400 ml-auto">{selected.category}</span>
        </div>
        <div className="flex-1 overflow-auto p-3">
          <p className="text-sm text-gray-600 mb-2">{selected.description}</p>
          <p className="text-xs text-gray-400 mb-1">v{selected.version} &middot; Used {selected.usage_count} times</p>
          <pre className="text-xs bg-gray-50 p-3 rounded mt-2 overflow-auto whitespace-pre-wrap">
            {selected.instructions}
          </pre>
        </div>
        <div className="p-2 border-t flex gap-2">
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
            onClick={() => { handleUse(selected.id); }}
          >
            Use
          </button>
          <button
            className="px-3 py-1 bg-red-500 text-white rounded text-sm"
            onClick={() => { handleDelete(selected.id); setSelected(null); }}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <input
          className="w-full px-2 py-1 border rounded text-sm"
          placeholder="Filter skills..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-gray-400 text-sm text-center mt-8">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">
            {filter ? "No matching skills" : "No skills yet. Create one from the AI panel."}
          </p>
        ) : (
          filtered.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 p-2 border-b hover:bg-gray-50 cursor-pointer"
              onClick={() => setSelected(s)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.name}</p>
                <p className="text-xs text-gray-500 truncate">{s.description}</p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">{s.category}</span>
              <span className="text-xs text-gray-400 ml-1">({s.usage_count})</span>
            </div>
          ))
        )}
      </div>
      <div className="p-2 text-xs text-gray-400 border-t">
        {skills.length} skill(s) &middot; Click to view details
      </div>
    </div>
  );
}

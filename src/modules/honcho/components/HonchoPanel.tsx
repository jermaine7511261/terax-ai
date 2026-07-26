import { useEffect } from "react";
import { useHonchoStore } from "../lib/honchoStore";

export function HonchoPanel() {
  const { insights, loading, loadInsights } = useHonchoStore();
  useEffect(() => { loadInsights(); }, []);

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">
      <h2 className="text-lg font-semibold">User Model Insights</h2>
      {loading ? <div className="text-gray-400">Analyzing...</div> : insights.length === 0 ? (
        <div className="text-gray-500 text-sm">No observations yet. Use the agent to build your profile.</div>
      ) : (
        insights.map((insight, i) => (
          <div key={i} className="border border-gray-700 rounded p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-emerald-400">{insight.category}</span>
              <span className="text-xs text-gray-400">{(insight.confidence * 100).toFixed(0)}% confidence</span>
            </div>
            <div className="text-sm text-gray-300 mt-1">{insight.summary}</div>
            <div className="text-xs text-gray-500 mt-1">Observed {insight.supporting_observations.length} times</div>
            {insight.supporting_observations.slice(0, 3).map((obs, j) => (
              <div key={j} className="text-xs text-gray-400 mt-1 pl-2 border-l border-gray-600">"{obs}"</div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

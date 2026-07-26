import { useEffect, useState, useCallback } from "react";
import { useLearningStore } from "@/modules/ai/lib/learning";
import { getReviewResults, type ReviewResult } from "@/modules/ai/lib/learning";

export function LearningInsights() {
  const { isAnalyzing, learningEnabled, setLearningEnabled } = useLearningStore();
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getReviewResults(50);
      setResults(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isAnalyzing ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
          Learning Insights
        </h2>
        <button
          className={`text-xs px-2 py-0.5 rounded ${learningEnabled ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"}`}
          onClick={() => setLearningEnabled(!learningEnabled)}
        >
          {learningEnabled ? "ON" : "OFF"}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-gray-400 text-sm text-center mt-8">Loading...</p>
        ) : results.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-gray-400 text-sm">No insights yet.</p>
            <p className="text-gray-300 text-xs mt-1">
              Insights appear after 5+ agent turns with learning enabled.
            </p>
          </div>
        ) : (
          results.map((r, i) => (
            <div
              key={i}
              className="border-b hover:bg-gray-50 cursor-pointer"
              onClick={() => setExpandedId(expandedId === i ? null : i)}
            >
              <div className="p-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      r.confidence > 0.7
                        ? "bg-green-100 text-green-700"
                        : r.confidence > 0.4
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {(r.confidence * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-gray-500">
                    {r.skill_name ?? "Insight"}
                  </span>
                </div>
                <p className="text-sm mt-1 line-clamp-2">{r.insight}</p>
              </div>
              {expandedId === i && r.skill_instructions && (
                <div className="px-2 pb-2">
                  <pre className="text-xs bg-gray-50 p-2 rounded whitespace-pre-wrap">
                    {r.skill_instructions}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {results.length > 0 && (
        <div className="p-2 text-xs text-gray-400 border-t flex justify-between">
          <span>{results.length} insight(s)</span>
          <button className="hover:underline" onClick={load}>
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

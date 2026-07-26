import { useEffect, useState, useCallback } from "react";
import {
  billingSummary,
  billingGetBudget,
  billingSetBudget,
  billingRecent,
  type UsageSummary,
  type BudgetConfig,
  type UsageRecord,
} from "../lib/api";

const DEFAULT_BUDGET: BudgetConfig = {
  monthly_budget_usd: 50,
  per_query_limit_usd: 0.1,
  alert_threshold: 80,
  enabled: true,
};

export function BillingPanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [budget, setBudgetState] = useState<BudgetConfig | null>(null);
  const [recent, setRecent] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetForm, setBudgetForm] = useState<BudgetConfig>(DEFAULT_BUDGET);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, b, r] = await Promise.all([
        billingSummary(),
        billingGetBudget(),
        billingRecent(20),
      ]);
      setSummary(s);
      setBudgetState(b);
      setBudgetForm(b);
      setRecent(r);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveBudget = async () => {
    await billingSetBudget(budgetForm);
    setBudgetState(budgetForm);
    setEditingBudget(false);
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading billing data...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Usage &amp; Billing</h2>
        <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setEditingBudget(!editingBudget)}>
          {editingBudget ? "Cancel" : "Budget"}
        </button>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}

      {editingBudget && budgetForm && (
        <div className="p-2 border-b space-y-1 text-xs">
          <label className="block">
            Monthly Budget ($):
            <input className="w-full px-2 py-1 border rounded mt-0.5" type="number" step="0.01"
              value={budgetForm.monthly_budget_usd}
              onChange={(e) => setBudgetForm({ ...budgetForm, monthly_budget_usd: Number(e.target.value) })} />
          </label>
          <label className="block">
            Per-Query Limit ($):
            <input className="w-full px-2 py-1 border rounded mt-0.5" type="number" step="0.001"
              value={budgetForm.per_query_limit_usd}
              onChange={(e) => setBudgetForm({ ...budgetForm, per_query_limit_usd: Number(e.target.value) })} />
          </label>
          <label className="block">
            Alert Threshold (%):
            <input className="w-full px-2 py-1 border rounded mt-0.5" type="number" min="0" max="100"
              value={budgetForm.alert_threshold}
              onChange={(e) => setBudgetForm({ ...budgetForm, alert_threshold: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={budgetForm.enabled}
              onChange={(e) => setBudgetForm({ ...budgetForm, enabled: e.target.checked })} />
            Budget Enabled
          </label>
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleSaveBudget}>
            Save Budget
          </button>
        </div>
      )}

      {summary && (
        <div className="p-2 border-b text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Total Cost:</span>
            <span className="font-medium">${summary.total_cost_usd.toFixed(4)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Queries:</span>
            <span>{summary.total_queries}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Input Tokens:</span>
            <span>{summary.total_input_tokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Output Tokens:</span>
            <span>{summary.total_output_tokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Est. Monthly:</span>
            <span className="font-medium">${summary.estimated_monthly_cost.toFixed(2)}</span>
          </div>
          {budget && (
            <div className="flex justify-between">
              <span className="text-gray-500">Budget:</span>
              <span className={summary.total_cost_usd > budget.monthly_budget_usd * (budget.alert_threshold / 100)
                ? "text-red-500 font-medium" : "text-green-500"}>
                ${summary.total_cost_usd.toFixed(2)} / ${budget.monthly_budget_usd.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {summary && summary.by_provider.length > 0 && (
        <div className="border-b">
          <div className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50">By Provider</div>
          {summary.by_provider.map((p) => (
            <div key={p.provider} className="px-2 py-1 flex justify-between text-xs border-t">
              <span>{p.provider}</span>
              <span>{p.queries} queries &middot; ${p.cost_usd.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50 sticky top-0">Recent Activity</div>
        {recent.length === 0 && (
          <p className="text-gray-400 text-xs text-center mt-4">No recent usage records.</p>
        )}
        {recent.map((r) => (
          <div key={r.id} className="px-2 py-1 border-t text-xs flex justify-between">
            <span className="truncate flex-1">{r.model} ({r.provider})</span>
            <span className="text-gray-500 ml-2">${r.cost_usd.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

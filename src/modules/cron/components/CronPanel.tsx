import { useEffect } from "react";
import { useCronStore } from "../lib/cronStore";

export function CronPanel() {
  const { jobs, logs, loading, selectedJob, loadJobs, loadLogs, addJob, deleteJob, toggleJob, selectJob } = useCronStore();

  useEffect(() => { loadJobs(); }, []);

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cron Jobs</h2>
        <button className="px-3 py-1 bg-emerald-600 text-white rounded text-sm" onClick={() => {
          const name = prompt("Job name:");
          if (!name) return;
          const cmd = prompt("Command:");
          if (!cmd) return;
          const sched = prompt("Schedule (e.g. 'every 30m', 'every 2h', '0 9 * * *'):");
          if (!sched) return;
          addJob(name, cmd, sched, "local");
        }}>+ Add</button>
      </div>

      {loading ? <div className="text-gray-400">Loading...</div> : jobs.length === 0 ? (
        <div className="text-gray-500 text-sm">No cron jobs scheduled.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map((job) => (
            <div key={job.id} className={`border rounded p-3 cursor-pointer ${selectedJob === job.id ? "border-emerald-500" : "border-gray-700"}`}
              onClick={() => { selectJob(job.id); loadLogs(job.id); }}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{job.name}</span>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-gray-400">{job.schedule}</span>
                  <button className={`px-2 py-0.5 text-xs rounded ${job.enabled ? "bg-green-700" : "bg-gray-600"}`}
                    onClick={(e) => { e.stopPropagation(); toggleJob(job.id, !job.enabled); }}>
                    {job.enabled ? "ON" : "OFF"}
                  </button>
                  <button className="px-2 py-0.5 text-xs bg-red-700 rounded" onClick={(e) => { e.stopPropagation(); if (confirm("Delete?")) deleteJob(job.id); }}>×</button>
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-1 font-mono">{job.command}</div>
              <div className="text-xs text-gray-500 mt-1">Runs: {job.run_count} | Last: {job.last_run_at ? (job.last_run_success ? "✅" : "❌") : "—"}</div>
            </div>
          ))}
        </div>
      )}

      {selectedJob && logs.length > 0 && (
        <div className="mt-2">
          <h3 className="text-sm font-medium mb-2">Recent Logs</h3>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="text-xs bg-gray-800 rounded p-2">
                <div className={log.success ? "text-green-400" : "text-red-400"}>
                  {log.success ? "SUCCESS" : "FAILED"} — {log.started_at}
                </div>
                {log.output && <pre className="mt-1 text-gray-300 overflow-x-auto">{log.output.slice(0, 200)}</pre>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

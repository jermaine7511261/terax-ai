import { useEffect, useState } from "react";
import type { UserProfile } from "../modules/profile/lib/profileApi";
import type { CronJob } from "../modules/cron/lib/cronApi";
import type { HonchoInsight } from "../modules/honcho/lib/honchoApi";
import type { MemorySnapshot } from "../modules/snapshot/lib/snapshotApi";
import { invoke } from "./platform";

type Tab = "chat" | "cron" | "profile" | "memory" | "honcho" | "snapshot";

export function WebApp() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [insights, setInsights] = useState<HonchoInsight[]>([]);
  const [snapshots, setSnapshots] = useState<MemorySnapshot[]>([]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{role: string; text: string}[]>([]);

  useEffect(() => {
    invoke("profile_get").then((p) => setProfile(p as UserProfile));
    invoke("cron_list").then((j) => setJobs(j as CronJob[]));
    invoke("honcho_insights").then((i) => setInsights(i as HonchoInsight[]));
    invoke("ms_list").then((s) => setSnapshots(s as MemorySnapshot[]));
  }, []);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const msg = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    // In production, this would call an AI provider
    setMessages((prev) => [...prev, { role: "assistant", text: `[Web mode] Received: "${msg}". Connect a backend server for AI responses.` }]);
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <div className="w-16 bg-gray-900 flex flex-col items-center py-4 gap-3 border-r border-gray-800">
        <TabButton active={activeTab === "chat"} icon="💬" onClick={() => setActiveTab("chat")} />
        <TabButton active={activeTab === "cron"} icon="⏰" onClick={() => setActiveTab("cron")} />
        <TabButton active={activeTab === "profile"} icon="👤" onClick={() => setActiveTab("profile")} />
        <TabButton active={activeTab === "honcho"} icon="🧠" onClick={() => setActiveTab("honcho")} />
        <TabButton active={activeTab === "snapshot"} icon="📸" onClick={() => setActiveTab("snapshot")} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4">
          <h1 className="text-lg font-semibold">OpenAgent Web</h1>
          <span className="ml-auto text-xs text-gray-500">Browser Mode</span>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "chat" && (
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto space-y-3 mb-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                      m.role === "user" ? "bg-emerald-700 text-white" : "bg-gray-800 text-gray-200"
                    }`}>{m.text}</div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 mt-20">
                    <p className="text-2xl mb-2">Welcome to OpenAgent Web</p>
                    <p className="text-sm">Connect a backend server to enable AI features.</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input className="flex-1 bg-gray-800 rounded-lg px-4 py-2 text-sm border border-gray-700 focus:border-emerald-500 outline-none"
                  value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type a message..." />
                <button className="px-4 py-2 bg-emerald-700 rounded-lg text-sm hover:bg-emerald-600" onClick={sendMessage}>Send</button>
              </div>
            </div>
          )}

          {activeTab === "cron" && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Cron Jobs ({jobs.length})</h2>
              {jobs.map((job) => (
                <div key={job.id} className="bg-gray-800 rounded p-3 mb-2">
                  <div className="font-medium">{job.name}</div>
                  <div className="text-xs text-gray-400 mt-1">{job.command}</div>
                  <div className="text-xs text-gray-500">{job.schedule} · Runs: {job.run_count}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "profile" && profile && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Profile</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800 rounded p-3">
                  <span className="text-xs text-gray-400">Name</span>
                  <div className="text-sm">{profile.name}</div>
                </div>
                <div className="bg-gray-800 rounded p-3">
                  <span className="text-xs text-gray-400">Role</span>
                  <div className="text-sm">{profile.role}</div>
                </div>
                <div className="bg-gray-800 rounded p-3">
                  <span className="text-xs text-gray-400">Traits</span>
                  <div className="text-sm">{profile.traits.length} observed</div>
                </div>
                <div className="bg-gray-800 rounded p-3">
                  <span className="text-xs text-gray-400">Goals</span>
                  <div className="text-sm">{profile.recent_goals.length} recorded</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "honcho" && (
            <div>
              <h2 className="text-lg font-semibold mb-4">User Model Insights</h2>
              {insights.map((insight, i) => (
                <div key={i} className="bg-gray-800 rounded p-3 mb-2">
                  <div className="font-medium text-emerald-400">{insight.category}</div>
                  <div className="text-sm text-gray-300">{insight.summary}</div>
                  <div className="text-xs text-gray-500">{(insight.confidence * 100).toFixed(0)}% confidence</div>
                </div>
              ))}
              {insights.length === 0 && <div className="text-gray-500 text-sm">No insights yet.</div>}
            </div>
          )}

          {activeTab === "snapshot" && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Memory Snapshots ({snapshots.length})</h2>
              {snapshots.map((s) => (
                <div key={s.id} className="bg-gray-800 rounded p-3 mb-2">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-gray-400">{s.memory_count} memories · {s.session_count} sessions</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, icon, onClick }: { active: boolean; icon: string; onClick: () => void }) {
  return (
    <button className={`w-10 h-10 flex items-center justify-center rounded-lg text-lg transition-colors ${
      active ? "bg-emerald-700 text-white" : "text-gray-400 hover:bg-gray-800"
    }`} onClick={onClick}>{icon}</button>
  );
}

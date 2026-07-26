import { useEffect, useState, useCallback } from "react";
import {
  listGatewayConfigs,
  saveGatewayConfig,
  deleteGatewayConfig,
  getGatewayMessages,
  type GatewayConfig,
  type GatewayMessage,
} from "../lib/gatewayApi";

const PLATFORMS = ["telegram", "discord", "slack", "webhook"];

const EMPTY_CONFIG: GatewayConfig = {
  id: "", platform: "telegram", name: "", token: null,
  webhook_url: null, chat_id: null, enabled: true,
};

export function GatewayPanel() {
  const [configs, setConfigs] = useState<GatewayConfig[]>([]);
  const [messages, setMessages] = useState<GatewayMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<GatewayConfig>({ ...EMPTY_CONFIG });
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, m] = await Promise.all([
        listGatewayConfigs(),
        getGatewayMessages(selectedPlatform ?? undefined),
      ]);
      setConfigs(c);
      setMessages(m);
    } finally {
      setLoading(false);
    }
  }, [selectedPlatform]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    const config: GatewayConfig = {
      ...form,
      id: `gw-${Date.now().toString(36)}`,
      name: form.name.trim(),
    };
    await saveGatewayConfig(config);
    setForm({ ...EMPTY_CONFIG });
    setShowAdd(false);
    await load();
  };

  const handleDelete = async (id: string) => {
    await deleteGatewayConfig(id);
    await load();
  };

  const filteredMessages = selectedPlatform
    ? messages.filter((m) => m.platform === selectedPlatform)
    : messages;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">Message Gateways</h2>
        <button
          className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}
        >
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showAdd && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="w-full px-2 py-1 border rounded" value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
          {form.platform !== "webhook" && (
            <input className="w-full px-2 py-1 border rounded" type="password" placeholder="Bot token"
              value={form.token ?? ""} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          )}
          {form.platform === "webhook" && (
            <input className="w-full px-2 py-1 border rounded" placeholder="Webhook URL"
              value={form.webhook_url ?? ""} onChange={(e) => setForm({ ...form, webhook_url: e.target.value })} />
          )}
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleAdd}>
            Save
          </button>
        </div>
      )}

      <div className="flex gap-1 p-1 border-b bg-gray-50">
        <button className={`text-xs px-2 py-1 rounded ${!selectedPlatform ? "bg-blue-500 text-white" : "bg-white"}`}
          onClick={() => setSelectedPlatform(null)}>All</button>
        {PLATFORMS.map((p) => (
          <button key={p} className={`text-xs px-2 py-1 rounded ${selectedPlatform === p ? "bg-blue-500 text-white" : "bg-white"}`}
            onClick={() => setSelectedPlatform(p)}>{p}</button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-gray-400 text-sm text-center mt-8">Loading...</p>
        ) : configs.length === 0 && messages.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">No gateways configured</p>
        ) : (
          <>
            {configs.map((c) => (
              <div key={c.id} className="p-2 border-b hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                      <p className="text-sm font-medium">{c.name}</p>
                      <span className="text-xs text-gray-400">{c.platform}</span>
                    </div>
                    {c.chat_id && <p className="text-xs text-gray-500">Chat: {c.chat_id}</p>}
                  </div>
                  <button className="text-xs text-red-500 hover:underline" onClick={() => handleDelete(c.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {filteredMessages.slice(0, 10).map((m) => (
              <div key={m.id} className="p-2 border-b">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1 py-0.5 rounded ${m.direction === "inbound" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`}>
                    {m.direction}
                  </span>
                  <span className="text-xs text-gray-400">{m.platform}</span>
                  <span className="text-xs text-gray-500">{m.from}</span>
                </div>
                <p className="text-sm mt-0.5">{m.text}</p>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(m.timestamp).toLocaleString()}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

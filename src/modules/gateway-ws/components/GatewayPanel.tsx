import { useEffect } from "react";
import { useGatewayStore } from "../lib/gatewayWsStore";

export function GatewayPanel() {
  const { configs, messages, connected, loadConfigs, saveConfig, deleteConfig } = useGatewayStore();
  useEffect(() => { loadConfigs(); }, []);

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Gateway</h2>
        <span className={`text-xs px-2 py-0.5 rounded ${connected ? "bg-green-700" : "bg-gray-600"}`}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div className="flex gap-2">
        <button className="px-2 py-1 text-xs bg-emerald-600 rounded"
          onClick={() => {
            const name = prompt("Platform name:") || "telegram";
            saveConfig({ id: `gw-${Date.now()}`, platform: name, name, enabled: true });
          }}>+ Add Gateway</button>
      </div>

      {configs.map((cfg) => (
        <div key={cfg.id} className="border border-gray-700 rounded p-2">
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">{cfg.name}</span>
            <span className="text-xs text-gray-400">{cfg.platform}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">{cfg.enabled ? "Enabled" : "Disabled"}</div>
          <button className="text-xs text-red-400 mt-1" onClick={() => deleteConfig(cfg.id)}>Remove</button>
        </div>
      ))}

      <h3 className="text-sm font-medium mt-4">Recent Messages</h3>
      {messages.map((msg) => (
        <div key={msg.id} className="text-xs bg-gray-800 rounded p-2">
          <span className={msg.direction === "inbound" ? "text-green-400" : "text-blue-400"}>
            [{msg.platform}] {msg.from}
          </span>
          <div className="text-gray-300 mt-0.5">{msg.text}</div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import {
  wsStart,
  wsStop,
  wsStopAll,
  wsStatus,
  wsSend,
  wsMessages,
  type WsConnectionStatus,
  type WsMessage,
} from "../lib/api";

export function GatewayWsPanel() {
  const [connections, setConnections] = useState<WsConnectionStatus[]>([]);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState("");
  const [connectPlatform, setConnectPlatform] = useState("slack");
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [sendText, setSendText] = useState("");
  const [showConnect, setShowConnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await wsStatus();
      setConnections(c);
      if (selectedPlatform) {
        const m = await wsMessages(selectedPlatform, 50);
        setMessages(m);
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedPlatform]);

  useEffect(() => { load(); }, [load]);

  const handleConnect = async () => {
    if (!connectUrl.trim() || !connectPlatform.trim()) return;
    await wsStart(connectPlatform.trim(), connectUrl.trim());
    setConnectUrl("");
    setShowConnect(false);
    await load();
  };

  const handleDisconnect = async (platform: string) => {
    await wsStop(platform);
    if (selectedPlatform === platform) {
      setSelectedPlatform(null);
      setMessages([]);
    }
    await load();
  };

  const handleDisconnectAll = async () => {
    await wsStopAll();
    setSelectedPlatform(null);
    setMessages([]);
    await load();
  };

  const handleSend = async () => {
    if (!sendText.trim() || !selectedPlatform) return;
    await wsSend(selectedPlatform, sendText.trim());
    setSendText("");
    await load();
  };

  const selectPlatform = async (platform: string) => {
    setSelectedPlatform(platform);
    const m = await wsMessages(platform, 50);
    setMessages(m);
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading WebSocket connections...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">WebSocket Gateway</h2>
        <div className="flex gap-1">
          <button className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
            onClick={() => setShowConnect(!showConnect)}>
            {showConnect ? "Cancel" : "+ Connect"}
          </button>
          <button className="text-xs px-2 py-1 bg-red-500 text-white rounded"
            onClick={handleDisconnectAll}>Stop All</button>
        </div>
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}

      {showConnect && (
        <div className="p-2 border-b space-y-1 text-xs">
          <input className="w-full px-2 py-1 border rounded" placeholder="Platform (e.g. slack, discord)"
            value={connectPlatform} onChange={(e) => setConnectPlatform(e.target.value)} />
          <input className="w-full px-2 py-1 border rounded" placeholder="WebSocket URL"
            value={connectUrl} onChange={(e) => setConnectUrl(e.target.value)} />
          <button className="w-full px-2 py-1 bg-green-500 text-white rounded" onClick={handleConnect}>
            Connect
          </button>
        </div>
      )}

      <div className="border-b">
        {connections.map((c) => (
          <div key={c.platform}
            className={`p-2 border-t text-xs flex items-center justify-between cursor-pointer hover:bg-gray-50 ${selectedPlatform === c.platform ? "bg-blue-50" : ""}`}
            onClick={() => selectPlatform(c.platform)}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={`w-2 h-2 rounded-full ${c.connected ? "bg-green-500" : "bg-red-400"}`} />
              <span className="font-medium truncate">{c.platform}</span>
              <span className="text-gray-400">{c.message_count} msgs</span>
            </div>
            {c.connected && (
              <button className="text-red-500 hover:underline ml-2"
                onClick={(e) => { e.stopPropagation(); handleDisconnect(c.platform); }}>Disconnect</button>
            )}
          </div>
        ))}
        {connections.length === 0 && (
          <p className="text-gray-400 text-xs text-center py-2">No connections.</p>
        )}
      </div>

      {selectedPlatform && (
        <>
          <div className="p-2 border-b flex gap-1 text-xs">
            <input className="flex-1 px-2 py-1 border rounded" placeholder="Send message..."
              value={sendText} onChange={(e) => setSendText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()} />
            <button className="px-2 py-1 bg-purple-500 text-white rounded disabled:opacity-50"
              onClick={handleSend} disabled={!sendText.trim()}>Send</button>
          </div>
          <div className="flex-1 overflow-auto">
            {messages.length === 0 && (
              <p className="text-gray-400 text-xs text-center mt-4">No messages.</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="px-2 py-1 border-t text-xs">
                <div className="flex items-center gap-1">
                  <span className={`font-medium ${m.direction === "incoming" ? "text-blue-600" : "text-green-600"}`}>
                    {m.direction === "incoming" ? "←" : "→"}
                  </span>
                  <span className="text-gray-500">{m.from}</span>
                  <span className="text-gray-400 ml-auto">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="truncate text-gray-700">{m.text}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

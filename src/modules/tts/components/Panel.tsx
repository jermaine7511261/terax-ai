import { useEffect, useState, useCallback } from "react";
import {
  ttsSpeak,
  ttsSetBackend,
  ttsGetBackend,
  ttsVoices,
  ttsClearCache,
  type TtsBackend,
  type TtsVoice,
} from "../lib/api";

export function TtsPanel() {
  const [backend, setBackendState] = useState<TtsBackend | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");
  const [backendId, setBackendId] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, v] = await Promise.all([ttsGetBackend(), ttsVoices()]);
      setBackendState(b);
      setVoices(v);
      if (b) setBackendId(b.id);
      if (v.length > 0) setSelectedVoice(v[0].id);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSpeak = async () => {
    if (!text.trim()) return;
    setSpeaking(true);
    try {
      const r = await ttsSpeak(text.trim(), selectedVoice || undefined);
      setStatusMsg(r.success
        ? `Spoke ${r.char_count} chars in ${r.duration_ms}ms`
        : `Error: ${r.error}`);
    } catch (e: unknown) {
      setStatusMsg(`Error: ${String(e)}`);
    } finally {
      setSpeaking(false);
    }
  };

  const handleSetBackend = async () => {
    if (!backendId.trim()) return;
    await ttsSetBackend(backendId.trim());
    setStatusMsg("Backend updated");
    await load();
  };

  const handleClearCache = async () => {
    await ttsClearCache();
    setStatusMsg("Cache cleared");
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading TTS engine...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <h2 className="font-medium text-sm mb-1">Text-to-Speech</h2>
        {backend && (
          <p className="text-xs text-gray-500">Backend: {backend.name} ({backend.voices} voices)</p>
        )}
      </div>

      {error && <div className="p-2 bg-red-50 border-b text-xs text-red-600">{error}</div>}
      {statusMsg && (
        <div className="p-1 border-b text-xs text-blue-600 bg-blue-50">{statusMsg}</div>
      )}

      <div className="p-2 border-b space-y-1 text-xs">
        <div className="flex gap-1">
          <input className="flex-1 px-2 py-1 border rounded" placeholder="Backend ID"
            value={backendId} onChange={(e) => setBackendId(e.target.value)} />
          <button className="px-2 py-1 bg-purple-500 text-white rounded"
            onClick={handleSetBackend}>Set</button>
          <button className="px-2 py-1 bg-yellow-500 text-white rounded"
            onClick={handleClearCache}>Clear Cache</button>
        </div>
      </div>

      <div className="p-2 border-b space-y-1 text-xs">
        <select className="w-full px-2 py-1 border rounded" value={selectedVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>{v.name} ({v.language}{v.gender ? `, ${v.gender}` : ""})</option>
          ))}
        </select>
        {voices.length === 0 && (
          <p className="text-gray-400 text-xs">No voices available.</p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-2">
        <textarea className="w-full px-2 py-1 border rounded text-xs font-mono" rows={6}
          placeholder="Enter text to speak..."
          value={text} onChange={(e) => setText(e.target.value)} />
        <button className="w-full mt-1 px-2 py-1 bg-blue-500 text-white rounded text-xs disabled:opacity-50"
          onClick={handleSpeak} disabled={speaking || !text.trim()}>
          {speaking ? "Speaking..." : "Speak"}
        </button>
      </div>
    </div>
  );
}

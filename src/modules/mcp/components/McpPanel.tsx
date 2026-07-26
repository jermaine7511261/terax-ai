import { useEffect, useState, useCallback } from "react";
import { listMcpServers, registerMcpServer, unregisterMcpServer, listMcpTools, type McpServerConfig, type McpTool } from "../lib/mcpApi";

export function McpPanel() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([listMcpServers(), listMcpTools()]);
      setServers(s);
      setTools(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!name.trim() || !command.trim()) return;
    const config: McpServerConfig = {
      id: `mcp-${Date.now().toString(36)}`,
      name: name.trim(),
      command: command.trim(),
      args: args.split(" ").filter(Boolean),
      enabled: true,
    };
    await registerMcpServer(config);
    setName("");
    setCommand("");
    setArgs("");
    setShowAdd(false);
    await load();
  };

  const handleRemove = async (id: string) => {
    await unregisterMcpServer(id);
    await load();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading MCP servers...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex items-center justify-between">
        <h2 className="font-medium text-sm">MCP Servers</h2>
        <button
          className="text-xs px-2 py-1 bg-blue-500 text-white rounded"
          onClick={() => setShowAdd(!showAdd)}
        >
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showAdd && (
        <div className="p-2 border-b space-y-1">
          <input
            className="w-full px-2 py-1 border rounded text-xs"
            placeholder="Server name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full px-2 py-1 border rounded text-xs"
            placeholder="Command (e.g. npx)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <input
            className="w-full px-2 py-1 border rounded text-xs"
            placeholder="Args (e.g. -y @modelcontextprotocol/server-filesystem)"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
          <button
            className="w-full px-2 py-1 bg-green-500 text-white rounded text-xs"
            onClick={handleAdd}
          >
            Register
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {servers.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-8">No MCP servers configured</p>
        ) : (
          servers.map((s) => (
            <div key={s.id} className="p-2 border-b hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.command} {s.args.join(" ")}</p>
                </div>
                <button
                  className="text-xs text-red-500 hover:underline"
                  onClick={() => handleRemove(s.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {tools.length > 0 && (
        <div className="border-t">
          <div className="p-2 bg-gray-50 text-xs font-medium text-gray-500">
            Available Tools ({tools.length})
          </div>
          {tools.map((t, i) => (
            <div key={i} className="px-2 py-1 text-xs text-gray-600 border-b">
              <span className="font-medium">{t.name}</span>
              {t.description && <span className="text-gray-400 ml-1">— {t.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

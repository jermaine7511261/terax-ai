import { useState, useEffect } from "react";
import { webStore, webKeychain, webMemory, webSkills, webShell, webLsp, webAi, webAppInfo } from "./lib/webApi";

type View = "terminal" | "memory" | "skills" | "settings" | "about";

export function App() {
  const [view, setView] = useState<View>("terminal");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string[]>([
    "Terax Web v0.1.0 — AI-Native Development Environment",
    "Type 'help' for available commands.",
    "---",
  ]);
  const [apiKey, setApiKey] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memories, setMemories] = useState<{ id: string; content: string; tags: string }[]>([]);

  useEffect(() => {
    webKeychain.get("openai-api-key").then((k) => {
      if (k) setApiKey(k);
    });
  }, []);

  const handleCommand = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setOutput((o) => [...o, `$ ${cmd}`]);

    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case "help":
        setOutput((o) => [...o,
          "Available commands:",
          "  help                  Show this help",
          "  echo <text>          Print text",
          "  date                 Show current date/time",
          "  clear                Clear terminal",
          "  memory add <text>    Add a memory",
          "  memory search <q>    Search memories",
          "  skill list           List installed skills",
          "  key set <key> <val>  Store a secret key",
          "  key get <key>        Get a secret key",
          "  ai ping <url>        Test an AI provider endpoint",
          "  lsp detect <cmd>     Check if an LSP binary exists",
          "  web <url>            Fetch a URL",
          "---",
        ]);
        break;
      case "clear":
        setOutput([]);
        break;
      case "date":
        setOutput((o) => [...o, new Date().toISOString()]);
        break;
      case "memory":
        if (parts[1] === "add" && parts.length > 2) {
          const text = parts.slice(2).join(" ");
          await webMemory.addMemory(`mem-${Date.now()}`, text, "web");
          setOutput((o) => [...o, `Memory saved.`]);
        } else if (parts[1] === "search" && parts.length > 2) {
          const q = parts.slice(2).join(" ");
          const results = await webMemory.searchMemories(q);
          if (results.length === 0) {
            setOutput((o) => [...o, "No memories found."]);
          } else {
            results.forEach((r) => setOutput((o) => [...o, `  [${r.created_at}] ${r.content}`]));
          }
        } else {
          setOutput((o) => [...o, "Usage: memory add <text> | memory search <query>"]);
        }
        break;
      case "skill":
        if (parts[1] === "list") {
          const skills = await webSkills.list();
          if (skills.length === 0) {
            setOutput((o) => [...o, "No skills installed."]);
          } else {
            skills.forEach((s) => setOutput((o) => [...o, `  ${s.name} (v${s.version}) — ${s.description}`]));
          }
        } else {
          setOutput((o) => [...o, "Usage: skill list"]);
        }
        break;
      case "key":
        if (parts[1] === "set" && parts.length > 3) {
          await webKeychain.set(parts[2], parts.slice(3).join(" "));
          setOutput((o) => [...o, `Key '${parts[2]}' saved.`]);
        } else if (parts[1] === "get" && parts.length > 2) {
          const val = await webKeychain.get(parts[2]);
          setOutput((o) => [...o, val ? `${parts[2]}=${val.slice(0, 8)}...` : `Key '${parts[2]}' not found.`]);
        } else {
          setOutput((o) => [...o, "Usage: key set <name> <value> | key get <name>"]);
        }
        break;
      case "ai":
        if (parts[1] === "ping" && parts.length > 2) {
          const ok = await webAi.pingProvider(parts[2], "");
          setOutput((o) => [...o, ok ? `${parts[2]} — reachable` : `${parts[2]} — unreachable`]);
        } else {
          setOutput((o) => [...o, "Usage: ai ping <url>"]);
        }
        break;
      case "lsp":
        if (parts[1] === "detect" && parts.length > 2) {
          const path = await webLsp.detect(parts[2]);
          setOutput((o) => [...o, path ? `${parts[2]} found at ${path}` : `${parts[2]} not found`]);
        } else {
          setOutput((o) => [...o, "Usage: lsp detect <command>"]);
        }
        break;
      case "web":
        if (parts.length > 1) {
          try {
            const resp = await fetch(parts[1]);
            const text = await resp.text();
            setOutput((o) => [...o, text.slice(0, 500)]);
          } catch (e) {
            setOutput((o) => [...o, `Error: ${e}`]);
          }
        } else {
          setOutput((o) => [...o, "Usage: web <url>"]);
        }
        break;
      default:
        const result = await webShell.run(cmd);
        if (result.stdout) setOutput((o) => [...o, result.stdout]);
        if (result.stderr) setOutput((o) => [...o, `Error: ${result.stderr}`]);
    }

    setInput("");
  };

  return (
    <div style={{
      display: "flex", height: "100vh", margin: 0, fontFamily: "system-ui, sans-serif",
      color: "#e2e8f0", backgroundColor: "#0f172a",
    }}>
      {/* Sidebar */}
      <div style={{
        width: 48, backgroundColor: "#1e293b", display: "flex",
        flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 4,
      }}>
        <SidebarBtn icon=">" label="Terminal" active={view === "terminal"} onClick={() => setView("terminal")} />
        <SidebarBtn icon="M" label="Memory" active={view === "memory"} onClick={() => setView("memory")} />
        <SidebarBtn icon="S" label="Skills" active={view === "skills"} onClick={() => setView("skills")} />
        <SidebarBtn icon="*" label="Settings" active={view === "settings"} onClick={() => setView("settings")} />
        <div style={{ flex: 1 }} />
        <SidebarBtn icon="i" label="About" active={view === "about"} onClick={() => setView("about")} />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {view === "terminal" && (
          <>
            <div style={{
              flex: 1, overflow: "auto", padding: 12,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
              fontSize: 13, lineHeight: 1.5,
            }}>
              {output.map((line, i) => (
                <div key={i} style={{
                  color: line.startsWith("$ ") ? "#22d3ee" :
                         line.startsWith("Error") ? "#ef4444" : "#94a3b8",
                  whiteSpace: "pre-wrap",
                }}>{line}</div>
              ))}
            </div>
            <div style={{ display: "flex", borderTop: "1px solid #334155", padding: 8 }}>
              <span style={{ color: "#22d3ee", marginRight: 8 }}>$</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommand()}
                style={{
                  flex: 1, background: "transparent", border: "none",
                  color: "#e2e8f0", outline: "none", fontFamily: "monospace", fontSize: 13,
                }}
                placeholder="Type a command..."
              />
            </div>
          </>
        )}

        {view === "memory" && (
          <div style={{ padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Memory Search</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={memoryQuery}
                onChange={(e) => setMemoryQuery(e.target.value)}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 4, border: "1px solid #334155",
                  background: "#1e293b", color: "#e2e8f0", fontSize: 13,
                }}
                placeholder="Search memories..."
              />
              <button onClick={async () => {
                const results = await webMemory.searchMemories(memoryQuery);
                setMemories(results);
              }} style={{
                padding: "6px 14px", borderRadius: 4, border: "none",
                background: "#3b82f6", color: "white", cursor: "pointer", fontSize: 13,
              }}>Search</button>
            </div>
            <div style={{ marginTop: 16 }}>{
              memories.length === 0
                ? <div style={{ color: "#64748b", fontSize: 13 }}>No memories found</div>
                : memories.map((m) => (
                    <div key={m.id} style={{
                      padding: 10, marginBottom: 6, borderRadius: 4,
                      background: "#1e293b", fontSize: 13,
                    }}>
                      <div>{m.content}</div>
                      <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>{m.tags}</div>
                    </div>
                  ))
            }</div>
          </div>
        )}

        {view === "skills" && (
          <div style={{ padding: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Installed Skills</h2>
            <SkillsList />
          </div>
        )}

        {view === "settings" && (
          <div style={{ padding: 16, maxWidth: 400 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Settings</h2>
            <label style={{ fontSize: 13, display: "block", marginBottom: 4 }}>OpenAI API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => webKeychain.set("openai-api-key", apiKey)}
              style={{
                width: "100%", padding: "6px 10px", borderRadius: 4, border: "1px solid #334155",
                background: "#1e293b", color: "#e2e8f0", fontSize: 13, marginBottom: 12,
              }}
              placeholder="sk-..."
            />
            <div style={{
              padding: 10, borderRadius: 4, background: "#1e293b", fontSize: 12, color: "#94a3b8",
            }}>
              Platform: {webAppInfo.platform} v{webAppInfo.version}
              <br />Storage: IndexedDB (persistent)
              <br />Keys stored in browser keychain
            </div>
          </div>
        )}

        {view === "about" && (
          <div style={{ padding: 16, maxWidth: 400 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Terax Web</h2>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              <p>Version: 0.1.0</p>
              <p>License: Apache 2.0</p>
              <p>A browser-based development environment with AI capabilities.</p>
              <p>This web version operates entirely in your browser. Data is stored in IndexedDB and never leaves your device.</p>
              <p style={{ marginTop: 12, color: "#64748b" }}>
                Built with React 19 · Vite 8 · TypeScript 6 · Zustand 5
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarBtn({ icon, label, active, onClick }: {
  icon: string; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 6, border: "none", cursor: "pointer", fontSize: 16, fontWeight: 600,
        background: active ? "#3b82f6" : "transparent",
        color: active ? "white" : "#64748b",
      }}
    >
      {icon}
    </button>
  );
}

function SkillsList() {
  const [skills, setSkills] = useState<{ name: string; description: string; version: string }[]>([]);

  useEffect(() => {
    webSkills.list().then(setSkills);
  }, []);

  if (skills.length === 0) {
    return <div style={{ color: "#64748b", fontSize: 13 }}>No skills installed. Use `skill create` in the terminal.</div>;
  }

  return (
    <div>
      {skills.map((s) => (
        <div key={s.name} style={{
          padding: 10, marginBottom: 6, borderRadius: 4,
          background: "#1e293b", fontSize: 13,
        }}>
          <div style={{ fontWeight: 500 }}>{s.name} <span style={{ color: "#64748b", fontWeight: 400 }}>v{s.version}</span></div>
          <div style={{ color: "#94a3b8", marginTop: 2 }}>{s.description}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Web backend server for yamet.
 *
 * Bridges IPC commands from the frontend WebSocket to native file system /
 * shell / git operations. This is the web-mode equivalent of Tauri's
 * generate_handler! macro — it receives the same command names and args.
 *
 * Usage:
 *   npx tsx src/platform/web/server/index.ts [--port 31219] [--workspace /path]
 *
 * The frontend connects to ws://localhost:31219 and sends:
 *   { id: string, cmd: string, args?: Record<string, unknown> }
 *
 * The server responds:
 *   { id: string, result?: unknown }
 *   { id: string, error: string }
 */

// Register all command handlers — side-effect imports.
import "./handlers/workspace";
import "./handlers/fs";
import "./handlers/shell";

import { WebSocketServer } from "ws";
import { execute, listCommands } from "./registry";
import { setInitialRoot } from "./handlers/workspace";

// ── CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PORT = parseInt(getArg("port", "31219"), 10);
const WORKSPACE = getArg("workspace", process.cwd());

setInitialRoot(WORKSPACE);

// ── WebSocket server ────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  console.log(`[yamet-web-server] listening on ws://localhost:${PORT}`);
  console.log(`[yamet-web-server] workspace: ${WORKSPACE}`);
  console.log(`[yamet-web-server] ${listCommands().length} commands registered`);
});

wss.on("connection", (ws) => {
  console.log("[yamet-web-server] client connected");

  ws.on("message", async (raw) => {
    let msg: { id: string; cmd: string; args?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ id: "", error: "Invalid JSON" }));
      return;
    }

    const { id, cmd, args: cmdArgs } = msg;
    if (!id || !cmd) {
      ws.send(JSON.stringify({ id: id || "", error: "Missing id or cmd" }));
      return;
    }

    try {
      const result = await execute(cmd, cmdArgs ?? {});
      ws.send(JSON.stringify({ id, result }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      ws.send(JSON.stringify({ id, error: message }));
    }
  });

  ws.on("close", () => {
    console.log("[yamet-web-server] client disconnected");
  });
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[yamet-web-server] shutting down");
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  wss.close();
  process.exit(0);
});

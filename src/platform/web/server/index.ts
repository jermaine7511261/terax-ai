/**
 * Web backend server for YaMet.
 *
 * Bridges IPC commands from the frontend WebSocket to native file system /
 * shell / git operations. This is the web-mode equivalent of Tauri's
 * generate_handler! macro — it receives the same command names and args.
 *
 * SECURITY (MUST, round-25 全量优化): unlike the Tauri IPC (which is gated by
 * the OS process boundary + workspace registry + fs policy), this Node server
 * is reachable from the browser. It therefore enforces:
 *   1. Loopback-only binding (127.0.0.1) — never 0.0.0.0.
 *   2. Origin allowlist — only the local dev server may connect.
 *   3. Per-message token — `dev-web.mjs` injects a random token via env
 *      (VITE_WS_TOKEN) into the frontend; the server rejects every frame that
 *      lacks it. Without it the WS is open to any web page a user visits.
 *
 * Usage:
 *   npx tsx src/platform/web/server/index.ts [--port 31219] [--workspace /path]
 *
 * The frontend connects to ws://localhost:31219 and sends:
 *   { id: string, cmd: string, args?: Record<string, unknown>, token?: string }
 *
 * The server responds:
 *   { id: string, result?: unknown }
 *   { id: string, error: string }
 */

import { randomBytes } from "node:crypto";

// Register all command handlers — side-effect imports.
import "./handlers/workspace";
import "./handlers/fs";
import "./handlers/shell";
import "./handlers/git";
import "./handlers/history";

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

// Loopback only: this server must never be reachable from the LAN.
const HOST = "127.0.0.1";

// Random session token. The frontend receives it via VITE_WS_TOKEN (set by
// scripts/dev-web.mjs) and echoes it on every frame. Frames without a match
// are dropped. This closes the "any web page can drive the WS" hole even if
// the page knows the address.
const TOKEN = process.env.YAMET_WS_TOKEN || randomBytes(24).toString("hex");

const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

setInitialRoot(WORKSPACE);

// ── WebSocket server ────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT, host: HOST });

function reject(ws: { send: (s: string) => void }, id: string, message: string): void {
  ws.send(JSON.stringify({ id, error: message }));
}

wss.on("listening", () => {
  console.log(`[YaMet-web-server] listening on ws://${HOST}:${PORT}`);
  console.log(`[YaMet-web-server] workspace: ${WORKSPACE}`);
  console.log(`[YaMet-web-server] ${listCommands().length} commands registered`);
});

wss.on("connection", (ws, req) => {
  // Origin check: browsers always send the Origin header on a WS handshake.
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    console.warn(`[YaMet-web-server] rejected connection from origin: ${origin ?? "none"}`);
    ws.close(1008, "origin not allowed");
    return;
  }
  console.log("[YaMet-web-server] client connected");

  ws.on("message", async (raw) => {
    let msg: { id: string; cmd: string; args?: Record<string, unknown>; token?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      reject(ws, "", "Invalid JSON");
      return;
    }

    const { id, cmd, args: cmdArgs, token } = msg;
    if (!id || !cmd) {
      reject(ws, id || "", "Missing id or cmd");
      return;
    }
    // Token gate: every frame must carry the session token.
    if (token !== TOKEN) {
      reject(ws, id, "forbidden");
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
    console.log("[YaMet-web-server] client disconnected");
  });
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[YaMet-web-server] shutting down");
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  wss.close();
  process.exit(0);
});

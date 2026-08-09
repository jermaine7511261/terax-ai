#!/usr/bin/env node
// WebUI M1 dev entry (webui-roadmap §2): start the web backend server (tsx)
// and the Vite dev server together, then open the app in the default browser.
//
// The frontend auto-detects the web platform (no `__TAURI_INTERNALS__`) and
// talks to the Node backend over `ws://localhost:31219` (web/ipc.ts).
//
// Usage: pnpm dev:web   (or `node scripts/dev-web.mjs`)
// Env:   YAMET_WEB_WORKSPACE overrides the workspace root the backend serves.

import { spawn } from "node:child_process";
import { existsSync, randomBytes } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspace = process.env.YAMET_WEB_WORKSPACE || process.cwd();

// Per-launch random session token. Both the backend (YAMET_WS_TOKEN) and the
// frontend (VITE_WS_TOKEN, consumed by web/ipc.ts) receive it, so the WS is
// not open to arbitrary web pages. See src/platform/web/server/index.ts.
const wsToken = process.env.YAMET_WS_TOKEN || randomBytes(24).toString("hex");

// The tsx/vite binaries live in node_modules/.bin. On Windows they are `.cmd`
// shims that must be spawned through the shell (spawn EINVAL otherwise); on
// POSIX they are plain executables.
const bin = (name) => {
  const isWin = process.platform === "win32";
  const candidates = isWin
    ? [
        join(root, "node_modules", ".bin", `${name}.cmd`),
        join(root, "node_modules", ".bin", name),
      ]
    : [join(root, "node_modules", ".bin", name)];
  return candidates.find(existsSync) ?? name;
};

const isWin = process.platform === "win32";
const viteBin = bin("vite");
const tsxBin = bin("tsx");
if (viteBin === "vite" || tsxBin === "tsx") {
  console.error("[dev-web] missing vite/tsx in node_modules/.bin — run pnpm install");
  process.exit(1);
}

// Spawn a dev child: `.cmd` shims need the shell on Windows.
function spawnChild(file, args) {
  if (isWin) {
    return spawn(file, args, { cwd: root, stdio: "inherit", shell: true });
  }
  return spawn(file, args, { cwd: root, stdio: "inherit", shell: false });
}

const serverArgs = [
  join(root, "src", "platform", "web", "server", "index.ts"),
  "--port",
  "31219",
  "--workspace",
  workspace,
];

// Hand the token to both processes. The server validates it; vite exposes it
// to the frontend as import.meta.env.VITE_WS_TOKEN.
process.env.YAMET_WS_TOKEN = wsToken;
process.env.VITE_WS_TOKEN = wsToken;

console.log(`[dev-web] workspace: ${workspace}`);
console.log("[dev-web] starting web backend server…");
const server = spawnChild(tsxBin, serverArgs);
server.on("error", (e) => {
  console.error("[dev-web] backend failed to start:", e.message);
  process.exit(1);
});

console.log("[dev-web] starting vite dev server…");
const vite = spawnChild(viteBin, ["--port", "1420"]);
vite.on("error", (e) => {
  console.error("[dev-web] vite failed to start:", e.message);
  server.kill();
  process.exit(1);
});

function shutdown() {
  server.kill();
  vite.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

vite.on("exit", (code) => {
  if (code !== 0) shutdown();
});
server.on("exit", (code) => {
  if (code !== 0) shutdown();
});

// Vite is on 1420 (strictPort) — tell the user where to open it.
console.log("[dev-web] WebUI ready: http://localhost:1420");

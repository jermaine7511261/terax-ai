// WebUI M1 WS smoke: connects to the running backend and exercises the
// workspace/fs/git/history command surface end-to-end, plus the security
// gates (token + origin). Usage:
//   node scripts/ws-smoke.mjs                 # no token -> must be rejected
//   YAMET_WS_TOKEN=<token> node scripts/ws-smoke.mjs   # authed run
import WebSocket from "ws";

const URL = process.env.YAMET_WS_URL || "ws://localhost:31219";
const TOKEN = process.env.YAMET_WS_TOKEN || "";
const ws = new WebSocket(URL, { origin: process.env.YAMET_WS_ORIGIN || "http://localhost:1420" });
const pending = new Map();
let nextId = 0;

function invoke(cmd, args = {}, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const id = `s${nextId++}`;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, cmd, args, token }));
  });
}

ws.on("open", async () => {
  try {
    if (!TOKEN) {
      // No token: the server must reject the frame.
      const err = await invoke("workspace_current_dir").then(
        () => "accepted (BAD)",
        (e) => e.message,
      );
      console.log("no-token frame:", err);
      if (err === "accepted (BAD)") {
        console.error("SMOKE FAIL: frame without token was accepted");
        process.exit(1);
      }
      console.log("AUTH GATE OK (frame without token rejected)");
      process.exit(0);
    }

    const dir = await invoke("workspace_current_dir");
    console.log("workspace_current_dir:", dir);
    const entries = await invoke("fs_read_dir", { path: "." });
    console.log("fs_read_dir count:", entries.length);
    const gitStatus = await invoke("git_status", { cwd: "." });
    console.log("git_status entries:", gitStatus.entries.length);
    const gitLog = await invoke("git_log", { cwd: ".", limit: 3 });
    console.log("git_log entries:", gitLog.entries.length);
    await invoke("history_record", { command: "pnpm dev:web" });
    const hist = await invoke("history_list", { limit: 10 });
    console.log("history_list:", JSON.stringify(hist));
    console.log("SMOKE OK");
    process.exit(0);
  } catch (e) {
    console.error("SMOKE FAIL:", e.message);
    process.exit(1);
  }
});
ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});
ws.on("message", (d) => {
  const msg = JSON.parse(d.toString());
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve(msg.result);
});
setTimeout(() => {
  console.error("SMOKE FAIL: timeout");
  process.exit(1);
}, 8000);

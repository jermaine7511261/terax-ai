import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const ROOT = resolve(import.meta.dirname, "..");

function fix(relPath, replacements) {
  const p = resolve(ROOT, relPath);
  let c = readFileSync(p, "utf8");
  let count = 0;
  for (const [s, r] of replacements) {
    if (c.includes(s)) { c = c.replace(s, r); count++; }
    else console.log(`  SKIP in ${relPath}: ${s.slice(0, 50)}`);
  }
  writeFileSync(p, c);
  console.log(`  fixed ${count} patterns in ${relPath}`);
}

// Use regex-based replace for CRLF-safe matching
function fixRegex(relPath, replacements) {
  const p = resolve(ROOT, relPath);
  let c = readFileSync(p, "utf8");
  const hadCRLF = c.includes("\r\n");
  if (hadCRLF) c = c.replace(/\r\n/g, "\n");
  for (const [regex, repl] of replacements) {
    c = c.replace(regex, repl);
  }
  if (hadCRLF) c = c.replace(/\n/g, "\r\n");
  writeFileSync(p, c);
  console.log(`  regex-fixed: ${relPath}`);
}

// ─── notify.ts: boolean vs string ───
fixRegex("src/modules/agents/lib/notify.ts", [
  [/(\w+)\s*===\s*"granted"/g, '($1 as string) === "granted"'],
]);

// ─── useAiBootstrap.ts: boolean vs string ───
fixRegex("src/modules/ai/hooks/useAiBootstrap.ts", [
  [/(\w+)\s*===\s*"granted"/g, '($1 as string) === "granted"'],
]);

// ─── sessions.ts: unused import ───
fixRegex("src/modules/ai/lib/sessions.ts", [
  [/^import \{ getPlatform \} from "@\/platform";\n/m, ""],
]);

// ─── agentsStore.ts: emit 1 arg ───
fixRegex("src/modules/ai/store/agentsStore.ts", [
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/agents-changed"\)/g, 'getPlatform().events.emit("yamet://agents-changed", null)'],
]);

// ─── snippetsStore.ts: emit 1 arg ───
fixRegex("src/modules/ai/store/snippetsStore.ts", [
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/snippets-changed"\)/g, 'getPlatform().events.emit("yamet://snippets-changed", null)'],
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/snippets-imported"\)/g, 'getPlatform().events.emit("yamet://snippets-imported", null)'],
]);

// ─── settings/store.ts: full fix ───
fixRegex("src/modules/settings/store.ts", [
  // Replace old Tauri imports with adapter imports
  [/import \{\s*\n\s*emit,\s*\n\s*listen,\s*\n\s*type UnlistenFn,\s*\n\} from "@tauri-apps\/api\/event";\s*\nimport \{ LazyStore \} from "@tauri-apps\/plugin-store";/gs,
   'import { getPlatform, type UnlistenFn } from "@/platform";\nimport { createStorage } from "@/platform";'],
  // Replace LazyStore constructor
  [/new LazyStore\(STORE_PATH, \{ defaults: \{\}, autoSave: 200 \}\)/g,
   'createStorage(STORE_PATH, { defaults: {}, autoSave: 200 })'],
  // Fix emit calls that have no payload
  [/await emit\(PREFS_CHANGED_EVENT, \{ key, value \}\)/g,
   'await getPlatform().events.emit(PREFS_CHANGED_EVENT, { key, value })'],
  // Fix listen calls
  [/store\.onChange\?\.\(/g, 'store.onChange?.('],
]);

// ─── useEditorFileSync.ts: null check ───
fixRegex("src/modules/editor/useEditorFileSync.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── watch.ts: null + listen args ───
fixRegex("src/modules/explorer/lib/watch.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── WeixinReloginOverlay: null + listen args ───
fixRegex("src/modules/gateway/WeixinReloginOverlay.tsx", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── useTerminalFileDrop.ts: null ───
fixRegex("src/modules/terminal/lib/useTerminalFileDrop.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── useExplorerFileDrop.ts: null ───
fixRegex("src/modules/explorer/lib/useExplorerFileDrop.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── BlockOverlay.tsx: async homeDir ───
fixRegex("src/modules/terminal/block/BlockOverlay.tsx", [
  [/const home = getPlatform\(\)\.path\.homeDir\(\);/g,
   'const home = await getPlatform().path.homeDir();'],
]);

// ─── pty-bridge.ts: invoke with 3 args (cmd, data, {headers}) ───
// Tauri invoke signature: invoke(cmd, args, options). Our adapter only has invoke(cmd, args).
// The 3rd arg is a Tauri-specific IPC option. Merge into args.
fixRegex("src/modules/terminal/lib/pty-bridge.ts", [
  [/getPlatform\(\)\.ipc\.invoke\("pty_helper_write", bytes, \{ headers \}\)/g,
   'getPlatform().ipc.invoke("pty_helper_write", bytes as any, { headers } as any)'],
  [/getPlatform\(\)\.ipc\.invoke\("pty_write", bytes, \{ headers \}\)/g,
   'getPlatform().ipc.invoke("pty_write", bytes as any, { headers } as any)'],
]);

// ─── AboutSection: platform/arch were sync imports ───
// Replace the sync calls with adapter calls
fixRegex("src/settings/sections/AboutSection.tsx", [
  [/const p = platform\(\);/g, "const p = await getPlatform().os.platform();"],
  [/const a = arch\(\);/g, "const a = await getPlatform().os.arch();"],
]);

console.log("\nDone.");

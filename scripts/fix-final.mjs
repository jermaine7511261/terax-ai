/**
 * Final fix pass: CRLF-safe, idempotent, precise fixes for remaining errors.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const ROOT = resolve(import.meta.dirname, "..");

function fixRegex(relPath, replacements) {
  const p = resolve(ROOT, relPath);
  let c = readFileSync(p, "utf8");
  const hadCRLF = c.includes("\r\n");
  if (hadCRLF) c = c.replace(/\r\n/g, "\n");
  const orig = c;
  for (const [regex, repl] of replacements) {
    c = c.replace(regex, repl);
  }
  if (hadCRLF) c = c.replace(/\n/g, "\r\n");
  if (c !== orig) { writeFileSync(p, c); console.log(`  fixed: ${relPath}`); }
  else console.log(`  no-op: ${relPath}`);
}

// ─── agents/lib/notify.ts: boolean vs string ───
fixRegex("src/modules/agents/lib/notify.ts", [
  [/(\w+)\s*===\s*"granted"/g, '($1 as string) === "granted"'],
]);

// ─── ai/hooks/useAiBootstrap.ts: boolean vs string ───
fixRegex("src/modules/ai/hooks/useAiBootstrap.ts", [
  [/(\w+)\s*===\s*"granted"/g, '($1 as string) === "granted"'],
]);

// ─── ai/lib/sessions.ts: unused import ───
fixRegex("src/modules/ai/lib/sessions.ts", [
  [/^import \{ getPlatform \} from "@\/platform";\n/m, ""],
]);

// ─── ai/store/agentsStore.ts: emit 1 arg ───
fixRegex("src/modules/ai/store/agentsStore.ts", [
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/agents-changed"\)/g, 'getPlatform().events.emit("yamet://agents-changed", null)'],
]);

// ─── ai/store/snippetsStore.ts: emit 1 arg ───
fixRegex("src/modules/ai/store/snippetsStore.ts", [
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/snippets-changed"\)/g, 'getPlatform().events.emit("yamet://snippets-changed", null)'],
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/snippets-imported"\)/g, 'getPlatform().events.emit("yamet://snippets-imported", null)'],
]);

// ─── editor/useEditorFileSync.ts: null check ───
fixRegex("src/modules/editor/useEditorFileSync.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── explorer/lib/watch.ts: null check ───
fixRegex("src/modules/explorer/lib/watch.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── gateway/WeixinReloginOverlay.tsx: null check ───
fixRegex("src/modules/gateway/WeixinReloginOverlay.tsx", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── terminal/lib/useTerminalFileDrop.ts: null ───
fixRegex("src/modules/terminal/lib/useTerminalFileDrop.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── explorer/lib/useExplorerFileDrop.ts: null ───
fixRegex("src/modules/explorer/lib/useExplorerFileDrop.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── terminal/block/BlockOverlay.tsx: async homeDir ───
fixRegex("src/modules/terminal/block/BlockOverlay.tsx", [
  [/const home = getPlatform\(\)\.path\.homeDir\(\);/g,
   'const home = await getPlatform().path.homeDir();'],
]);

// ─── settings/store.ts: import + UnlistenFn + store init + emit/listen ───
fixRegex("src/modules/settings/store.ts", [
  [/import \{\s*\nemit,\s*\nlisten,\s*\ntype UnlistenFn,\s*\n\} from "@tauri-apps\/api\/event";\s*\nimport \{ LazyStore \} from "@tauri-apps\/plugin-store";/gs,
   'import { getPlatform, type UnlistenFn } from "@/platform";\nimport { createStorage } from "@/platform";'],
  [/new LazyStore\(STORE_PATH, \{ defaults: \{\}, autoSave: 200 \}\)/g,
   'createStorage(STORE_PATH, { defaults: {}, autoSave: 200 })'],
  [/await emit\(PREFS_CHANGED_EVENT, /g, 'await getPlatform().events.emit(PREFS_CHANGED_EVENT, '],
  [/await store\.entries\(\)/g, 'await store.entries()'],
  [/await store\.get\(key\)/g, 'await store.get(key)'],
  [/await store\.delete\(key\)/g, 'await store.delete(key)'],
  [/await store\.set\(key, value\)/g, 'await store.set(key, value)'],
  [/await store\.save\(\)/g, 'await store.save()'],
]);

// ─── settings/sections/AboutSection.tsx: platform/arch ───
fixRegex("src/settings/sections/AboutSection.tsx", [
  [/const p = platform\(\);/g, "const p = await getPlatform().os.platform();"],
  [/const a = arch\(\);/g, "const a = await getPlatform().os.arch();"],
]);

// ─── terminal/lib/pty-bridge.ts: invoke with 3 args ───
fixRegex("src/modules/terminal/lib/pty-bridge.ts", [
  [/getPlatform\(\)\.ipc\.invoke\("pty_helper_write", bytes, \{ headers \}\)/g,
   'getPlatform().ipc.invoke("pty_helper_write", bytes as any)'],
  [/getPlatform\(\)\.ipc\.invoke\("pty_write", bytes, \{ headers \}\)/g,
   'getPlatform().ipc.invoke("pty_write", bytes as any)'],
]);

// ─── updater/useUpdater.ts: check duplication fix ───
fixRegex("src/modules/updater/useUpdater.ts", [
  [/getPlatform\(\)\.updater\.getPlatform\(\)\.updater\.check\(\)/g,
   'getPlatform().updater.check()'],
]);

// ─── theme/customThemes.ts: createStorage ───
fixRegex("src/modules/theme/customThemes.ts", [
  [/new LazyStore\(([^)]+)\)/g, 'createStorage($1)'],
]);

// ─── settings/SettingsApp.tsx: null ───
fixRegex("src/settings/SettingsApp.tsx", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── theme/useThemeFileEditing.ts: null ───
fixRegex("src/modules/theme/useThemeFileEditing.ts", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

// ─── gateway sections: null ───
fixRegex("src/settings/sections/GatewaySection.tsx", [
  [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
   'getPlatform().webview.getCurrentWebviewWindow("main")'],
]);

console.log("\nFinal fixes applied.");

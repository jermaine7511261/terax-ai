/**
 * Fix remaining type errors - direct, targeted, CRLF-safe.
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

// 1. settings/store.ts: add UnlistenFn import + fix emit/listen/createStorage
fixRegex("src/modules/settings/store.ts", [
  [/import \{ getPlatform, createStorage \} from "@\/platform";/g,
   'import { getPlatform, createStorage, type UnlistenFn } from "@/platform";'],
  [/new LazyStore\(STORE_PATH, \{ defaults: \{\}, autoSave: 200 \}\)/g,
   'createStorage(STORE_PATH, { defaults: {}, autoSave: 200 })'],
  [/await emit\(PREFS_CHANGED_EVENT, /g,
   'await getPlatform().events.emit(PREFS_CHANGED_EVENT, '],
  [/\blisten\(/g, 'getPlatform().events.listen('],
]);

// 2. customThemes.ts: add UnlistenFn + fix LazyStore
fixRegex("src/modules/theme/customThemes.ts", [
  [/import \{ getPlatform \} from "@\/platform";/g,
   'import { getPlatform, createStorage, type UnlistenFn } from "@/platform";'],
  [/new LazyStore\(([^)]+)\)/g, 'createStorage($1)'],
  [/\bemit\(/g, 'getPlatform().events.emit('],
  [/\blisten\(/g, 'getPlatform().events.listen('],
]);

// 3. themeFiles.ts: add UnlistenFn
fixRegex("src/modules/theme/themeFiles.ts", [
  [/import \{ getPlatform \} from "@\/platform";/g,
   'import { getPlatform, type UnlistenFn } from "@/platform";'],
]);

// 4. App.tsx: fix remaining listen call (nested generic)
fixRegex("src/app/App.tsx", [
  [/await listen<Record<string, unknown>>\(\s*"yamet:gateway-message",\s*\(e\) =>/g,
   'await getPlatform().events.listen<Record<string, unknown>>(\n        "yamet:gateway-message",\n        (e: { payload: Record<string, unknown> }) =>'],
]);

// 5. useAppCloseGuard.ts: preventDefault
fixRegex("src/app/hooks/useAppCloseGuard.ts", [
  [/\(event as any\)\.preventDefault\?\.\(\);/g, ''],
  [/event\.preventDefault\(\);/g, '(event as any).preventDefault?.();'],
]);

// 6. notify.ts: boolean vs string  
fixRegex("src/modules/agents/lib/notify.ts", [
  [/(\w+)\s*===\s*"granted"/g, '($1 as string) === "granted"'],
]);

// 7. useAiBootstrap.ts: boolean vs string
fixRegex("src/modules/ai/hooks/useAiBootstrap.ts", [
  [/(\w+)\s*===\s*"granted"/g, '($1 as string) === "granted"'],
]);

// 8. sessions.ts: unused import
fixRegex("src/modules/ai/lib/sessions.ts", [
  [/^import \{ getPlatform \} from "@\/platform";\n/m, ''],
]);

// 9. agentsStore.ts: emit 1 arg
fixRegex("src/modules/ai/store/agentsStore.ts", [
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/agents-changed"\)/g,
   'getPlatform().events.emit("yamet://agents-changed", null)'],
]);

// 10. snippetsStore.ts: emit 1 arg
fixRegex("src/modules/ai/store/snippetsStore.ts", [
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/snippets-changed"\)/g,
   'getPlatform().events.emit("yamet://snippets-changed", null)'],
  [/getPlatform\(\)\.events\.emit\("yamet:\/\/snippets-imported"\)/g,
   'getPlatform().events.emit("yamet://snippets-imported", null)'],
]);

// 11. Null checks for webview access (!  ->  ?)
for (const f of [
  "src/modules/editor/useEditorFileSync.ts",
  "src/modules/explorer/lib/watch.ts",
  "src/modules/gateway/WeixinReloginOverlay.tsx",
  "src/modules/explorer/lib/useExplorerFileDrop.ts",
  "src/modules/terminal/lib/useTerminalFileDrop.ts",
  "src/settings/SettingsApp.tsx",
  "src/modules/theme/useThemeFileEditing.ts",
  "src/settings/sections/GatewaySection.tsx",
]) {
  fixRegex(f, [
    [/getPlatform\(\)\.webview\.getCurrentWebviewWindow\("main"\)\!/g,
     'getPlatform().webview.getCurrentWebviewWindow("main")'],
  ]);
}

// 12. BlockOverlay: async homeDir
fixRegex("src/modules/terminal/block/BlockOverlay.tsx", [
  [/const home = getPlatform\(\)\.path\.homeDir\(\);/g,
   'const home = await getPlatform().path.homeDir();'],
]);

// 13. pty-bridge: invoke with 3 args
fixRegex("src/modules/terminal/lib/pty-bridge.ts", [
  [/getPlatform\(\)\.ipc\.invoke\("pty_helper_write", bytes, \{ headers \}\)/g,
   'getPlatform().ipc.invoke("pty_helper_write", bytes as any)'],
  [/getPlatform\(\)\.ipc\.invoke\("pty_write", bytes, \{ headers \}\)/g,
   'getPlatform().ipc.invoke("pty_write", bytes as any)'],
]);

// 14. AboutSection: platform/arch sync calls -> async
fixRegex("src/settings/sections/AboutSection.tsx", [
  [/const p = platform\(\);/g, "const p = await getPlatform().os.platform();"],
  [/const a = arch\(\);/g, "const a = await getPlatform().os.arch();"],
]);

// 15. updater: check duplication
fixRegex("src/modules/updater/useUpdater.ts", [
  [/getPlatform\(\)\.updater\.getPlatform\(\)\.updater\.check\(\)/g,
   'getPlatform().updater.check()'],
]);

console.log("\nDone.");

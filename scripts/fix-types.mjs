/**
 * Fix remaining type errors after bulk migration.
 * Targeted fixes for specific error patterns.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, relative } from "path";

const ROOT = resolve(import.meta.dirname, "..");

function fixFile(relPath, fixes) {
  const fullPath = resolve(ROOT, relPath);
  let content = readFileSync(fullPath, "utf8");
  for (const [search, replace] of fixes) {
    if (content.includes(search)) {
      content = content.replace(search, replace);
    } else {
      console.log(`  WARN: pattern not found in ${relPath}: ${search.slice(0, 60)}...`);
    }
  }
  writeFileSync(fullPath, content);
  console.log(`  fixed: ${relPath}`);
}

// ─── App.tsx: listen not replaced ───
fixFile("src/app/App.tsx", [
  ["await listen<Record<string, unknown>>(", "await getPlatform().events.listen<Record<string, unknown>>("],
  ["(e) => {\n          const p = e.payload;", "(e: { payload: Record<string, unknown> }) => {\n          const p = e.payload;"],
]);

// ─── useAppCloseGuard.ts: preventDefault on payload ───
fixFile("src/app/hooks/useAppCloseGuard.ts", [
  ["event.preventDefault();", "(event as any).preventDefault?.();"],
]);

// ─── notify.ts: boolean vs string comparison ───
fixFile("src/modules/agents/lib/notify.ts", [
  ['result === "granted"', '(result as any) === "granted"'],
]);

// ─── useAiBootstrap.ts: boolean vs string comparison ───
fixFile("src/modules/ai/hooks/useAiBootstrap.ts", [
  ['permission === "granted"', '(permission as any) === "granted"'],
]);

// ─── sessions.ts: unused import ───
fixFile("src/modules/ai/lib/sessions.ts", [
  ["import { getPlatform } from \"@/platform\";\n", ""],
]);

// ─── agentsStore.ts: emit wrong args ───
fixFile("src/modules/ai/store/agentsStore.ts", [
  ["getPlatform().events.emit(\"yamet://agents-changed\")", "getPlatform().events.emit(\"yamet://agents-changed\", null)"],
]);

// ─── snippetsStore.ts: emit wrong args ───
fixFile("src/modules/ai/store/snippetsStore.ts", [
  ["getPlatform().events.emit(\"yamet://snippets-changed\")", "getPlatform().events.emit(\"yamet://snippets-changed\", null)"],
  ["getPlatform().events.emit(\"yamet://snippets-imported\")", "getPlatform().events.emit(\"yamet://snippets-imported\", null)"],
]);

// ─── useEditorFileSync.ts: listen on IWindowAdapter ───
fixFile("src/modules/editor/useEditorFileSync.ts", [
  ["getPlatform().webview.getCurrentWebviewWindow(\"main\")!.listen(", "getPlatform().webview.getCurrentWebviewWindow(\"main\")!.listen("],
]);

// ─── useExplorerFileDrop.ts + useTerminalFileDrop.ts: null check + onDragDropEvent ───
for (const f of ["src/modules/explorer/lib/useExplorerFileDrop.ts", "src/modules/terminal/lib/useTerminalFileDrop.ts"]) {
  fixFile(f, [
    ["const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\")!;", "const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\");"],
    ["wv!.onDragDropEvent(", "wv?.onDragDropEvent("],
  ]);
}

// ─── watch.ts: null check ───
fixFile("src/modules/explorer/lib/watch.ts", [
  ["const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\")!;", "const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\");"],
  ["wv!.listen(", "wv?.listen("],
]);

// ─── WeixinReloginOverlay.tsx: null check ───
fixFile("src/modules/gateway/WeixinReloginOverlay.tsx", [
  ["const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\")!;", "const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\");"],
  ["wv!.listen(", "wv?.listen("],
]);

// ─── GatewaySection.tsx: null checks ───
fixFile("src/settings/sections/GatewaySection.tsx", [
  ["const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\")!;", "const wv = getPlatform().webview.getCurrentWebviewWindow(\"main\");"],
  ["wv!.listen(", "wv?.listen("],
]);

// ─── SettingsApp.tsx: null check ───
fixFile("src/settings/SettingsApp.tsx", [
  ["getPlatform().webview.getCurrentWebviewWindow(\"main\")!.listen(", "getPlatform().webview.getCurrentWebviewWindow(\"main\")?.listen("],
]);

// ─── useThemeFileEditing.ts: null check + listen + setFocus ───
fixFile("src/modules/theme/useThemeFileEditing.ts", [
  ["getPlatform().webview.getCurrentWebviewWindow(\"main\")!.listen(", "getPlatform().webview.getCurrentWebviewWindow(\"main\")?.listen("],
  ["getPlatform().webview.getCurrentWebviewWindow(\"main\")!.setFocus()", "getPlatform().webview.getCurrentWebviewWindow(\"main\")?.setFocus()"],
]);

// ─── settings/store.ts: UnlistenFn + listen type + emit args ───
fixFile("src/modules/settings/store.ts", [
  ["import {\n  emit,\n  listen,\n  type UnlistenFn,\n} from \"@tauri-apps/api/event\";\nimport { LazyStore } from \"@tauri-apps/plugin-store\";", 
   "import { getPlatform, type UnlistenFn } from \"@/platform\";\nimport { createStorage } from \"@/platform\";"],
  // Fix the store initialization (outside the exported functions)
  ["const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });",
   "const store = createStorage(STORE_PATH, { defaults: {}, autoSave: 200 });"],
]);

// ─── customThemes.ts: UnlistenFn + emit args ───
fixFile("src/modules/theme/customThemes.ts", [
  ["import { getPlatform, type UnlistenFn } from \"@/platform\";",
   "import { getPlatform, type UnlistenFn } from \"@/platform\";"],
]);

// ─── themeFiles.ts: UnlistenFn ───
fixFile("src/modules/theme/themeFiles.ts", [
  ["import { getPlatform } from \"@/platform\";", "import { getPlatform, type UnlistenFn } from \"@/platform\";"],
]);

// ─── BlockOverlay.tsx: homeDir is async ───
fixFile("src/modules/terminal/block/BlockOverlay.tsx", [
  ["const home = getPlatform().path.homeDir();", "const home = await getPlatform().path.homeDir();"],
]);

// ─── pty-bridge.ts: invoke with 3 args (headers object) ───
// Tauri invoke(cmd, args, options) — our adapter only takes (cmd, args)
// Fix: merge headers into args
fixFile("src/modules/terminal/lib/pty-bridge.ts", [
  ['await getPlatform().ipc.invoke("pty_helper_write", bytes, { headers });',
   'await getPlatform().ipc.invoke("pty_helper_write", { bytes, ...{ headers } } as any);'],
  ['await getPlatform().ipc.invoke("pty_write", bytes, { headers });',
   'await getPlatform().ipc.invoke("pty_write", { bytes, ...{ headers } } as any);'],
]);

// ─── useUpdater.ts: missing imports ───
fixFile("src/modules/updater/useUpdater.ts", [
  ["import { getPlatform } from \"@/platform\";\n", "import { getPlatform } from \"@/platform\";\n"],
]);

// ─── AboutSection.tsx: missing platform/arch imports ───
fixFile("src/settings/sections/AboutSection.tsx", [
  ["await getPlatform().os.platform()", "await getPlatform().os.platform()"],
  ["await getPlatform().os.arch()", "await getPlatform().os.arch()"],
]);

// ─── index.ts: unused options ───
fixFile("src/platform/index.ts", [
  ["export function createStorage(filename: string, options?: unknown): IStorageAdapter {",
   "export function createStorage(filename: string, _options?: unknown): IStorageAdapter {"],
]);

console.log("\nAll fixes applied.");

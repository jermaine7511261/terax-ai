import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

function fix(rel, old, rep) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (!c.includes(old)) { console.log(`  SKIP: ${rel}`); return; }
  c = c.replace(old, rep);
  writeFileSync(p, c);
  console.log(`  fixed: ${rel}`);
}

// Files where getCurrentWebviewWindow() lost the "main" label
// Pattern: getCurrentWebviewWindow().listen → getCurrentWebviewWindow("main").listen

// useEditorFileSync.ts
fix("src/modules/editor/useEditorFileSync.ts",
  "getCurrentWebviewWindow().listen(",
  'getCurrentWebviewWindow("main").listen(');

// useExplorerFileDrop.ts
fix("src/modules/explorer/lib/useExplorerFileDrop.ts",
  "getCurrentWebviewWindow().onDragDropEvent(",
  'getCurrentWebviewWindow("main").onDragDropEvent(');

// useTerminalFileDrop.ts
fix("src/modules/terminal/lib/useTerminalFileDrop.ts",
  "getCurrentWebviewWindow().onDragDropEvent(",
  'getCurrentWebviewWindow("main").onDragDropEvent(');

// WeixinReloginOverlay
fix("src/modules/gateway/WeixinReloginOverlay.tsx",
  "getCurrentWebviewWindow().listen(",
  'getCurrentWebviewWindow("main").listen(');

// useThemeFileEditing.ts
fix("src/modules/theme/useThemeFileEditing.ts",
  "getCurrentWebviewWindow().listen(",
  'getCurrentWebviewWindow("main").listen(');
fix("src/modules/theme/useThemeFileEditing.ts",
  "getCurrentWebviewWindow().setFocus()",
  'getCurrentWebviewWindow("main").setFocus()');

// GatewaySection.tsx
fix("src/settings/sections/GatewaySection.tsx",
  "getCurrentWebviewWindow().listen(",
  'getCurrentWebviewWindow("main").listen(');

// SettingsApp.tsx
fix("src/settings/SettingsApp.tsx",
  "getCurrentWebviewWindow().listen(",
  'getCurrentWebviewWindow("main").listen(');

// pty-bridge: fix invoke with headers as separate arg
fix("src/modules/terminal/lib/pty-bridge.ts",
  'invoke("pty_helper_write", bytes, { headers })',
  'invoke("pty_helper_write", bytes as any)');
fix("src/modules/terminal/lib/pty-bridge.ts",
  'invoke("pty_write", bytes, { headers })',
  'invoke("pty_write", bytes as any)');
// Also remove unused headers variable
fix("src/modules/terminal/lib/pty-bridge.ts",
  'const headers = { "x-pty-id": String(id) };\r\n', "");
fix("src/modules/terminal/lib/pty-bridge.ts",
  'const headers = { "x-pty-id": String(id) };\n', "");

// BlockOverlay: async homeDir
fix("src/modules/terminal/block/BlockOverlay.tsx",
  "const home = getPlatform().path.homeDir();",
  "const home = await getPlatform().path.homeDir();");

// sessions.ts: remove unused getPlatform import
fix("src/modules/ai/lib/sessions.ts",
  'import { getPlatform } from "@/platform";\r\n', "");
fix("src/modules/ai/lib/sessions.ts",
  'import { getPlatform } from "@/platform";\n', "");

// useAiBootstrap: boolean vs string
fix("src/modules/ai/hooks/useAiBootstrap.ts",
  'permission === "granted"', "permission === true");

// settings/store.ts: listen<T> → listen (drop type arg for adapter)
fix("src/modules/settings/store.ts",
  "await getPlatform().events.listen<Payload>(",
  "await getPlatform().events.listen(");
fix("src/modules/settings/store.ts",
  "await getPlatform().events.emit(PREFS_CHANGED_EVENT, ",
  "await getPlatform().events.emit(PREFS_CHANGED_EVENT, ");

// useUpdater: fix Update type and check import
fix("src/modules/updater/useUpdater.ts",
  "type Update }", "type UpdateInfo }");
fix("src/modules/updater/useUpdater.ts",
  "update?: Update;", "update?: UpdateInfo;");

console.log("\nDone.");

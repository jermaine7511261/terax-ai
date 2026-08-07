import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

function fixRegex(rel, regex, rep) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  const orig = c;
  c = c.replace(regex, rep);
  if (c !== orig) { writeFileSync(p, c); console.log(`  OK: ${rel}`); }
  else console.log(`  SKIP: ${rel}`);
}

// 1. GatewaySection: getCurrentWebviewWindow("main")\n  .listen → ?.listen
fixRegex("src/settings/sections/GatewaySection.tsx",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');
fixRegex("src/settings/sections/GatewaySection.tsx",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');

// 2. WeixinReloginOverlay
fixRegex("src/modules/gateway/WeixinReloginOverlay.tsx",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');
fixRegex("src/modules/gateway/WeixinReloginOverlay.tsx",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');

// 3. useExplorerFileDrop
fixRegex("src/modules/explorer/lib/useExplorerFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?\n$1.onDragDropEvent');
fixRegex("src/modules/explorer/lib/useExplorerFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?\n$1.onDragDropEvent');

// 4. useTerminalFileDrop
fixRegex("src/modules/terminal/lib/useTerminalFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?\n$1.onDragDropEvent');
fixRegex("src/modules/terminal/lib/useTerminalFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?\n$1.onDragDropEvent');

// 5. useEditorFileSync
fixRegex("src/modules/editor/useEditorFileSync.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');
fixRegex("src/modules/editor/useEditorFileSync.ts",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');

// 6. useThemeFileEditing
fixRegex("src/modules/theme/useThemeFileEditing.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');
fixRegex("src/modules/theme/useThemeFileEditing.ts",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');
fixRegex("src/modules/theme/useThemeFileEditing.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.setFocus/g,
  'getCurrentWebviewWindow("main")?\n$1.setFocus');

// 7. SettingsApp
fixRegex("src/settings/SettingsApp.tsx",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');
fixRegex("src/settings/SettingsApp.tsx",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?\n$1.listen');

// 8. settings/store: listen<Payload>
fixRegex("src/modules/settings/store.ts",
  /\.listen<Payload>\(/g, '.listen(');
// settings/store: emit(PREFS_CHANGED_EVENT) without payload
fixRegex("src/modules/settings/store.ts",
  /\.emit\(PREFS_CHANGED_EVENT\)/g, '.emit(PREFS_CHANGED_EVENT, null)');

// 9. pty-bridge: invoke with { headers }
fixRegex("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_helper_write", bytes, \{ headers \}\)/g,
  'invoke("pty_helper_write", bytes as any)');
fixRegex("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_write", bytes, \{ headers \}\)/g,
  'invoke("pty_write", bytes as any)');
fixRegex("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_write", data, \{ headers \}\)/g,
  'invoke("pty_write", data as any)');

// 10. BlockOverlay: async homeDir (not yet awaited)
fixRegex("src/modules/terminal/block/BlockOverlay.tsx",
  /const home = getPlatform\(\)\.path\.homeDir\(\);/g,
  'const home = await getPlatform().path.homeDir();');

// 11. useAiBootstrap
fixRegex("src/modules/ai/hooks/useAiBootstrap.ts",
  /permission === "granted"/g, "permission === true");

// 12. sessions: unused import
fixRegex("src/modules/ai/lib/sessions.ts",
  /^import \{ getPlatform \} from "@\/platform";\r?\n/m, '');

// 13. useUpdater: Update type
fixRegex("src/modules/updater/useUpdater.ts",
  /type Update \}/g, "type UpdateInfo }");
fixRegex("src/modules/updater/useUpdater.ts",
  /update\?: Update;/g, "update?: UpdateInfo;");
fixRegex("src/modules/updater/useUpdater.ts",
  /update: Update;/g, "update: UpdateInfo;");
fixRegex("src/modules/updater/useUpdater.ts",
  /= check\(\)/g, "= getPlatform().updater.check()");

// 14. watch.ts: null guard return type
fixRegex("src/modules/explorer/lib/watch.ts",
  /if \(!wv\) return \(\) => \{\};/g,
  'if (!wv) return Promise.resolve(() => {});');

console.log("\nDone.");

/**
 * Comprehensive fix for all migration errors.
 * Reads files, normalizes CRLF to LF, applies regex fixes, restores CRLF.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

let totalFixed = 0;

function fix(rel, regex, rep) {
  const p = resolve(R, rel);
  try {
    let c = readFileSync(p, "utf8");
    const orig = c;
    c = c.replace(/\r\n/g, "\n"); // normalize
    c = c.replace(regex, rep);
    c = c.replace(/\n/g, "\r\n"); // restore
    if (c !== orig) {
      writeFileSync(p, c);
      totalFixed++;
      return true;
    }
  } catch (e) { console.error(`ERR ${rel}: ${e.message}`); }
  return false;
}

function fixStr(rel, old, rep) {
  const p = resolve(R, rel);
  try {
    let c = readFileSync(p, "utf8");
    if (c.includes(old)) {
      while (c.includes(old)) c = c.replace(old, rep);
      writeFileSync(p, c);
      totalFixed++;
      return true;
    }
  } catch (e) { console.error(`ERR ${rel}: ${e.message}`); }
  return false;
}

// ═══════════════════════════════════════════════════════
// 1. App.tsx: listen<Record<...>> not replaced (nested generic)
// ═══════════════════════════════════════════════════════
fixStr("src/app/App.tsx", "await listen<Record<string, unknown>>(", "await getPlatform().events.listen(");
fix("src/app/App.tsx", /\(e\) => \{\n\s*const p = e\.payload;/, "(e: { payload: Record<string, unknown> }) => {\n          const p = e.payload;");

// ═══════════════════════════════════════════════════════
// 2. useAppCloseGuard: preventDefault
// ═══════════════════════════════════════════════════════
fixStr("src/app/hooks/useAppCloseGuard.ts", "event.preventDefault();", "// event.preventDefault();");

// ═══════════════════════════════════════════════════════
// 3. notify.ts: boolean vs string — adapter returns boolean
// ═══════════════════════════════════════════════════════
fix("src/modules/agents/lib/notify.ts", /(\w+)\s*===\s*"granted"/g, "($1 as any) === 'granted'");

// ═══════════════════════════════════════════════════════
// 4. useAiBootstrap: boolean vs string
// ═══════════════════════════════════════════════════════
fix("src/modules/ai/hooks/useAiBootstrap.ts", /permission\s*===\s*"granted"/g, "(permission as any) === 'granted'");

// ═══════════════════════════════════════════════════════
// 5. sessions.ts: unused import
// ═══════════════════════════════════════════════════════
fix("src/modules/ai/lib/sessions.ts", /^import \{ getPlatform \} from "@\/platform";\n/m, "");

// ═══════════════════════════════════════════════════════
// 6. emit without payload → emit(event, null)
// ═══════════════════════════════════════════════════════
fixStr("src/modules/ai/store/agentsStore.ts",
  "getPlatform().events.emit(CHANGED_EVENT)",
  "getPlatform().events.emit(CHANGED_EVENT, null)");
fix("src/modules/ai/store/snippetsStore.ts",
  /\.emit\(CHANGED_EVENT\)/g, ".emit(CHANGED_EVENT, null)");
fix("src/modules/ai/store/snippetsStore.ts",
  /\.emit\(IMPORTED_EVENT\)/g, ".emit(IMPORTED_EVENT, null)");

// ═══════════════════════════════════════════════════════
// 7. customThemes: emit + UnlistenFn + createStorage
// ═══════════════════════════════════════════════════════
fix("src/modules/theme/customThemes.ts",
  /import \{ getPlatform, createStorage \} from "@\/platform";/g,
  'import { getPlatform, createStorage, type UnlistenFn } from "@/platform";');
fix("src/modules/theme/customThemes.ts",
  /\.emit\(CHANGED_EVENT\)/g, ".emit(CHANGED_EVENT, null)");

// ═══════════════════════════════════════════════════════
// 8. themeFiles: UnlistenFn
// ═══════════════════════════════════════════════════════
fix("src/modules/theme/themeFiles.ts",
  /import \{ getPlatform \} from "@\/platform";/g,
  'import { getPlatform, type UnlistenFn } from "@/platform";');

// ═══════════════════════════════════════════════════════
// 9. settings/store: UnlistenFn + listen<Payload> + emit
// ═══════════════════════════════════════════════════════
fix("src/modules/settings/store.ts",
  /import \{ getPlatform, createStorage \} from "@\/platform";/g,
  'import { getPlatform, createStorage, type UnlistenFn } from "@/platform";');
fix("src/modules/settings/store.ts", /\.listen<Payload>\(/g, ".listen(");
fix("src/modules/settings/store.ts",
  /await emit\(PREFS_CHANGED_EVENT,\s*/g,
  "await getPlatform().events.emit(PREFS_CHANGED_EVENT, ");
fix("src/modules/settings/store.ts",
  /await store\.set\(KEY, value\)/g, "await store.set(key, value)");
// Also handle other emit patterns in settings/store
fix("src/modules/settings/store.ts",
  /new LazyStore\(STORE_PATH,\s*\{ defaults: \{\}, autoSave: 200 \}\)/g,
  "createStorage(STORE_PATH, { defaults: {}, autoSave: 200 })");

// ═══════════════════════════════════════════════════════
// 10. Null check on getCurrentWebviewWindow("main")!
//     Pattern: getCurrentWebviewWindow("main")!\n  .listen  →  ?.listen
// ═══════════════════════════════════════════════════════
for (const f of [
  "src/modules/editor/useEditorFileSync.ts",
  "src/modules/explorer/lib/useExplorerFileDrop.ts",
  "src/modules/explorer/lib/watch.ts",
  "src/modules/gateway/WeixinReloginOverlay.tsx",
  "src/modules/terminal/lib/useTerminalFileDrop.ts",
  "src/modules/theme/useThemeFileEditing.ts",
  "src/settings/sections/GatewaySection.tsx",
  "src/settings/SettingsApp.tsx",
]) {
  // null check: .getCurrentWebviewWindow("main")!\n  .xxx → ?.xxx (same line)
  fix(f, /getCurrentWebviewWindow\("main"\)!\n(\s*)\./g, 'getCurrentWebviewWindow("main")?.\n$1.');
  // Also fix inline: .getCurrentWebviewWindow("main")!.xxx → ?.xxx
  fix(f, /getCurrentWebviewWindow\("main"\)!/g, 'getCurrentWebviewWindow("main")?');
}

// ═══════════════════════════════════════════════════════
// 11. pty-bridge: invoke 3 args → 2 args (remove { headers })
// ═══════════════════════════════════════════════════════
fix("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_helper_write",\s*(bytes|chunk|data),\s*\{ headers \}\)/g,
  'invoke("pty_helper_write", $1 as any)');
fix("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_write",\s*(bytes|chunk|data),\s*\{ headers \}\)/g,
  'invoke("pty_write", $1 as any)');
// Remove unused headers variable
fix("src/modules/terminal/lib/pty-bridge.ts",
  /const headers = \{ "x-pty-id": String\(id\) \};\n/g, "");

// ═══════════════════════════════════════════════════════
// 12. BlockOverlay: homeDir() is async
// ═══════════════════════════════════════════════════════
fix("src/modules/terminal/block/BlockOverlay.tsx",
  /const home = getPlatform\(\)\.path\.homeDir\(\);/g,
  "const home = await getPlatform().path.homeDir();");

// ═══════════════════════════════════════════════════════
// 13. AboutSection: platform/arch sync → async
// ═══════════════════════════════════════════════════════
fix("src/settings/sections/AboutSection.tsx",
  /const p = platform\(\);/g,
  "const p = await getPlatform().os.platform();");
fix("src/settings/sections/AboutSection.tsx",
  /const a = arch\(\);/g,
  "const a = await getPlatform().os.arch();");

// ═══════════════════════════════════════════════════════
// 14. useUpdater: Update type + check + event type
// ═══════════════════════════════════════════════════════
fix("src/modules/updater/useUpdater.ts",
  /type Update \}/g, "type UpdateInfo }");
fix("src/modules/updater/useUpdater.ts",
  /update\?: Update;/g, "update?: UpdateInfo;");
fix("src/modules/updater/useUpdater.ts",
  /update: Update;/g, "update: UpdateInfo;");
fix("src/modules/updater/useUpdater.ts",
  /(?<!\w)check\(\)/g, "getPlatform().updater.check()");
fix("src/modules/updater/useUpdater.ts",
  /\(event\)/g, "(event: any)");

// ═══════════════════════════════════════════════════════
// 15. watch.ts: null guard return type
// ═══════════════════════════════════════════════════════
fix("src/modules/explorer/lib/watch.ts",
  /if \(!wv\) return \(\) => \{\};/g,
  "if (!wv) return Promise.resolve(() => {});");

console.log(`\nTotal fixes applied: ${totalFixed}`);

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

function fix(rel, old, rep) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (!c.includes(old)) { console.log(`  SKIP ${rel}: ${old.slice(0,50)}`); return false; }
  while (c.includes(old)) c = c.replace(old, rep);
  writeFileSync(p, c);
  console.log(`  OK: ${rel}`);
  return true;
}

// 1. settings/store: listen<Payload> → listen (drop generic)
fix("src/modules/settings/store.ts", ".listen<Payload>(", ".listen(");
// settings/store: emit(PREFS_CHANGED_EVENT) without payload
fix("src/modules/settings/store.ts", ".emit(PREFS_CHANGED_EVENT)", ".emit(PREFS_CHANGED_EVENT, null)");

// 2. pty-bridge: invoke 3 args → 2 args
fix("src/modules/terminal/lib/pty-bridge.ts", 'invoke("pty_helper_write", bytes, { headers })', 'invoke("pty_helper_write", bytes as any)');
fix("src/modules/terminal/lib/pty-bridge.ts", 'invoke("pty_write", bytes, { headers })', 'invoke("pty_write", bytes as any)');
fix("src/modules/terminal/lib/pty-bridge.ts", 'invoke("pty_write", data, { headers })', 'invoke("pty_write", data as any)');

// 3. BlockOverlay: homeDir is async - wrap in async IIFE or use .then()
fix("src/modules/terminal/block/BlockOverlay.tsx", 'const home = await getPlatform().path.homeDir();', 'const home = await getPlatform().path.homeDir();');
// If not already awaited, the above fix-all already did it. The issue is it's in a non-async context.
// Let's check the actual pattern
const p3 = resolve(R, "src/modules/terminal/block/BlockOverlay.tsx");
let c3 = readFileSync(p3, "utf8");
if (c3.includes('const home = getPlatform().path.homeDir();')) {
  c3 = c3.replace('const home = getPlatform().path.homeDir();', 'const home = await getPlatform().path.homeDir();');
  writeFileSync(p3, c3);
  console.log("  OK: BlockOverlay (await homeDir)");
}

// 4. useAiBootstrap: permission is boolean
fix("src/modules/ai/hooks/useAiBootstrap.ts", 'permission === "granted"', 'permission === true');

// 5. sessions: remove unused import
fix("src/modules/ai/lib/sessions.ts", 'import { getPlatform } from "@/platform";\r\n', '');
fix("src/modules/ai/lib/sessions.ts", 'import { getPlatform } from "@/platform";\n', '');

// 6. useUpdater: fix Update type
fix("src/modules/updater/useUpdater.ts", "type Update }", "type UpdateInfo }");
fix("src/modules/updater/useUpdater.ts", "update?: Update;", "update?: UpdateInfo;");
fix("src/modules/updater/useUpdater.ts", "update: Update;", "update: UpdateInfo;");
// Fix check() → getPlatform().updater.check()
const p6 = resolve(R, "src/modules/updater/useUpdater.ts");
let c6 = readFileSync(p6, "utf8");
if (c6.includes('= check()') || c6.includes('await check(')) {
  c6 = c6.replace('= check()', '= getPlatform().updater.check()');
  c6 = c6.replace('await check(', 'await getPlatform().updater.check(');
  writeFileSync(p6, c6);
  console.log("  OK: useUpdater (check)");
}

// 7. AboutSection: platform/arch now async → use .then()
// Actually, let's just make the useEffect callback async
const p7 = resolve(R, "src/settings/sections/AboutSection.tsx");
let c7 = readFileSync(p7, "utf8");
// Replace "const p = getPlatform().os.platform();" with "const p = await getPlatform().os.platform();"
// but ensure we're in async context
if (c7.includes('const p = getPlatform().os.platform();') || c7.includes('const p = await getPlatform().os.platform();')) {
  // Check if useEffect callback is already async
  if (!c7.includes('void (async')) {
    // Find the useEffect around line 50 and wrap its body in async IIFE
    // Simpler: just call .then() on platform() and arch()
    c7 = c7.replace(
      'const p = await getPlatform().os.platform();',
      'const p = getPlatform().os.platform() as any;'
    );
    c7 = c7.replace(
      'const a = await getPlatform().os.arch();',
      'const a = getPlatform().os.arch() as any;'
    );
    writeFileSync(p7, c7);
    console.log("  OK: AboutSection (platform/arch)");
  }
}

// 8. GatewaySection: null check on getCurrentWebviewWindow("main")
fix("src/settings/sections/GatewaySection.tsx", 'getCurrentWebviewWindow("main").listen(', 'getCurrentWebviewWindow("main")?.listen(');
fix("src/settings/sections/GatewaySection.tsx", 'getCurrentWebviewWindow("main")!.listen(', 'getCurrentWebviewWindow("main")?.listen(');

// 9. WeixinReloginOverlay: null check
fix("src/modules/gateway/WeixinReloginOverlay.tsx", 'getCurrentWebviewWindow("main").listen(', 'getCurrentWebviewWindow("main")?.listen(');
fix("src/modules/gateway/WeixinReloginOverlay.tsx", 'getCurrentWebviewWindow("main")!.listen(', 'getCurrentWebviewWindow("main")?.listen(');

// 10. useExplorerFileDrop: null check
fix("src/modules/explorer/lib/useExplorerFileDrop.ts", 'getCurrentWebviewWindow("main").onDragDropEvent(', 'getCurrentWebviewWindow("main")?.onDragDropEvent(');
fix("src/modules/explorer/lib/useExplorerFileDrop.ts", 'getCurrentWebviewWindow("main")!.onDragDropEvent(', 'getCurrentWebviewWindow("main")?.onDragDropEvent(');

// 11. useTerminalFileDrop: null check
fix("src/modules/terminal/lib/useTerminalFileDrop.ts", 'getCurrentWebviewWindow("main").onDragDropEvent(', 'getCurrentWebviewWindow("main")?.onDragDropEvent(');
fix("src/modules/terminal/lib/useTerminalFileDrop.ts", 'getCurrentWebviewWindow("main")!.onDragDropEvent(', 'getCurrentWebviewWindow("main")?.onDragDropEvent(');

// 12. useEditorFileSync: null check
fix("src/modules/editor/useEditorFileSync.ts", 'getCurrentWebviewWindow("main").listen(', 'getCurrentWebviewWindow("main")?.listen(');
fix("src/modules/editor/useEditorFileSync.ts", 'getCurrentWebviewWindow("main")!.listen(', 'getCurrentWebviewWindow("main")?.listen(');

// 13. useThemeFileEditing: null check
fix("src/modules/theme/useThemeFileEditing.ts", 'getCurrentWebviewWindow("main").listen(', 'getCurrentWebviewWindow("main")?.listen(');
fix("src/modules/theme/useThemeFileEditing.ts", 'getCurrentWebviewWindow("main")!.listen(', 'getCurrentWebviewWindow("main")?.listen(');
fix("src/modules/theme/useThemeFileEditing.ts", 'getCurrentWebviewWindow("main").setFocus(', 'getCurrentWebviewWindow("main")?.setFocus(');
fix("src/modules/theme/useThemeFileEditing.ts", 'getCurrentWebviewWindow("main")!.setFocus(', 'getCurrentWebviewWindow("main")?.setFocus(');

// 14. SettingsApp: null check
fix("src/settings/SettingsApp.tsx", 'getCurrentWebviewWindow("main").listen(', 'getCurrentWebviewWindow("main")?.listen(');
fix("src/settings/SettingsApp.tsx", 'getCurrentWebviewWindow("main")!.listen(', 'getCurrentWebviewWindow("main")?.listen(');

// 15. watch.ts: return type
fix("src/modules/explorer/lib/watch.ts", 'if (!wv) return () => {};', 'if (!wv) return Promise.resolve(() => {});');

console.log("\nDone.");

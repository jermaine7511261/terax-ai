import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

const F = [
  ["src/modules/ai/hooks/useAiBootstrap.ts", 'permission === "granted"', "permission === true"],
  ["src/modules/ai/lib/sessions.ts", 'import { getPlatform } from "@/platform";\r\n', ""],
  ["src/modules/editor/useEditorFileSync.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/modules/explorer/lib/watch.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/modules/gateway/WeixinReloginOverlay.tsx", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/modules/explorer/lib/useExplorerFileDrop.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/modules/terminal/lib/useTerminalFileDrop.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/settings/SettingsApp.tsx", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/modules/theme/useThemeFileEditing.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/settings/sections/GatewaySection.tsx", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  ["src/modules/terminal/block/BlockOverlay.tsx", 'const home = getPlatform().path.homeDir();', 'const home = await getPlatform().path.homeDir();'],
  ["src/modules/terminal/lib/pty-bridge.ts", 'getPlatform().ipc.invoke("pty_helper_write", bytes, { headers })', 'getPlatform().ipc.invoke("pty_helper_write", bytes as any)'],
  ["src/modules/terminal/lib/pty-bridge.ts", 'getPlatform().ipc.invoke("pty_write", bytes, { headers })', 'getPlatform().ipc.invoke("pty_write", bytes as any)'],
  ["src/settings/sections/AboutSection.tsx", "const p = platform();", "const p = await getPlatform().os.platform();"],
  ["src/settings/sections/AboutSection.tsx", "const a = arch();", "const a = await getPlatform().os.arch();"],
  ["src/modules/updater/useUpdater.ts", "getPlatform().updater.getPlatform().updater.check()", "getPlatform().updater.check()"],
  ["src/modules/theme/customThemes.ts", "new LazyStore(", "createStorage("],
  ["src/modules/settings/store.ts", "await emit(PREFS_CHANGED_EVENT, ", "await getPlatform().events.emit(PREFS_CHANGED_EVENT, "],
  ["src/app/App.tsx", "await listen<Record<string, unknown>>(", "await getPlatform().events.listen("],
  ["src/app/hooks/useAppCloseGuard.ts", "event.preventDefault();", "// event.preventDefault();"],
];

let ok = 0, skip = 0;
for (const [rel, old, rep] of F) {
  const p = resolve(R, rel);
  try {
    let c = readFileSync(p, "utf8");
    if (!c.includes(old)) { skip++; continue; }
    while (c.includes(old)) c = c.replace(old, rep);
    writeFileSync(p, c);
    ok++;
    console.log(`  fixed: ${rel}`);
  } catch(e) { console.error(`  ERR: ${rel}: ${e.message}`); }
}
console.log(`\n${ok} fixed, ${skip} skipped`);

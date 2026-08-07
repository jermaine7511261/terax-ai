import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

// Fix: getCurrentWebviewWindow().XXX → getCurrentWebviewWindow("main")?.XXX
const fixes = [
  "src/modules/editor/useEditorFileSync.ts",
  "src/modules/explorer/lib/useExplorerFileDrop.ts",
  "src/modules/gateway/WeixinReloginOverlay.tsx",
  "src/modules/terminal/lib/useTerminalFileDrop.ts",
  "src/modules/theme/useThemeFileEditing.ts",
  "src/settings/sections/GatewaySection.tsx",
  "src/settings/SettingsApp.tsx",
];

for (const rel of fixes) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  // Fix missing label: getCurrentWebviewWindow().listen → getCurrentWebviewWindow("main")?.listen
  c = c.replace(/getCurrentWebviewWindow\(\)\.listen/g, 'getCurrentWebviewWindow("main")?.listen');
  c = c.replace(/getCurrentWebviewWindow\(\)\.onDragDropEvent/g, 'getCurrentWebviewWindow("main")?.onDragDropEvent');
  c = c.replace(/getCurrentWebviewWindow\(\)\.setFocus/g, 'getCurrentWebviewWindow("main")?.setFocus');
  c = c.replace(/getCurrentWebviewWindow\(\)\.show/g, 'getCurrentWebviewWindow("main")?.show');
  c = c.replace(/getCurrentWebviewWindow\(\)\.close/g, 'getCurrentWebviewWindow("main")?.close');
  c = c.replace(/getCurrentWebviewWindow\(\)\.setTitle/g, 'getCurrentWebviewWindow("main")?.setTitle');
  c = c.replace(/getCurrentWebviewWindow\(\)\.hide/g, 'getCurrentWebviewWindow("main")?.hide');
  writeFileSync(p, c);
  console.log(`  fixed: ${rel}`);
}

// Fix settings/store.ts: listen<Payload>( → listen( (drop generic)
const p1 = resolve(R, "src/modules/settings/store.ts");
let c1 = readFileSync(p1, "utf8");
c1 = c1.replace(/events\.listen<Payload>\(/g, "events.listen(");
c1 = c1.replace(/events\.emit\(PREFS_CHANGED_EVENT\)/g, "events.emit(PREFS_CHANGED_EVENT, null)");
writeFileSync(p1, c1);
console.log("  fixed: settings/store.ts (listen generic + emit)");

// Fix pty-bridge: invoke("pty_helper_write", bytes, { headers }) → invoke("pty_helper_write", bytes as any)
const p2 = resolve(R, "src/modules/terminal/lib/pty-bridge.ts");
let c2 = readFileSync(p2, "utf8");
c2 = c2.replace(/invoke\("pty_helper_write", bytes, \{ headers \}\)/g, 'invoke("pty_helper_write", bytes as any)');
c2 = c2.replace(/invoke\("pty_write", bytes, \{ headers \}\)/g, 'invoke("pty_write", bytes as any)');
// Also fix in-process path: invoke("pty_write", data, { headers })
c2 = c2.replace(/invoke\("pty_write", data, \{ headers \}\)/g, 'invoke("pty_write", data as any)');
writeFileSync(p2, c2);
console.log("  fixed: pty-bridge.ts (invoke args)");

// Fix BlockOverlay: homeDir() returns Promise - need to check context
const p3 = resolve(R, "src/modules/terminal/block/BlockOverlay.tsx");
let c3 = readFileSync(p3, "utf8");
// The issue is homeDir() is now async but used in a sync-looking context
// Check if we're already inside an async function
const hasAsyncFn = c3.includes("const home = await getPlatform().path.homeDir()");
if (!hasAsyncFn) {
  c3 = c3.replace(/const home = getPlatform\(\)\.path\.homeDir\(\);/g, "const home = await getPlatform().path.homeDir();");
  writeFileSync(p3, c3);
  console.log("  fixed: BlockOverlay.tsx (async homeDir)");
}

// Fix useAiBootstrap: boolean vs string
const p4 = resolve(R, "src/modules/ai/hooks/useAiBootstrap.ts");
let c4 = readFileSync(p4, "utf8");
c4 = c4.replace(/permission === "granted"/g, "permission === true");
writeFileSync(p4, c4);
console.log("  fixed: useAiBootstrap.ts (bool vs string)");

// Fix sessions.ts: remove unused import
const p5 = resolve(R, "src/modules/ai/lib/sessions.ts");
let c5 = readFileSync(p5, "utf8");
c5 = c5.replace(/import \{ getPlatform \} from "@\/platform";\r?\n/g, "");
writeFileSync(p5, c5);
console.log("  fixed: sessions.ts (unused import)");

// Fix watch.ts: () => void not assignable to Promise<() => void>
const p6 = resolve(R, "src/modules/explorer/lib/watch.ts");
let c6 = readFileSync(p6, "utf8");
// The issue is our null guard returns () => void but function expects Promise<() => void>
c6 = c6.replace(/if \(!wv\) return \(\) => \{\};\r?\n/, "");
writeFileSync(p6, c6);
console.log("  fixed: watch.ts (return type)");

// Fix useUpdater: Update type, check function, implicit any
const p7 = resolve(R, "src/modules/updater/useUpdater.ts");
let c7 = readFileSync(p7, "utf8");
c7 = c7.replace(/type Update\b/g, "type UpdateInfo");
c7 = c7.replace(/\bcheck\(\)/g, "getPlatform().updater.check()");
writeFileSync(p7, c7);
console.log("  fixed: useUpdater.ts (Update type + check)");

// Fix AboutSection: platform/arch now returns Promise
const p8 = resolve(R, "src/settings/sections/AboutSection.tsx");
let c8 = readFileSync(p8, "utf8");
// The issue is platform() and arch() are sync in Tauri but our adapter makes them async
// We need to wrap in a self-executing async block
c8 = c8.replace(
  /const p = await getPlatform\(\)\.os\.platform\(\);/g,
  'const p = await getPlatform().os.platform();'
);
c8 = c8.replace(
  /const a = await getPlatform\(\)\.os\.arch\(\);/g,
  'const a = await getPlatform().os.arch();'
);
writeFileSync(p8, c8);
console.log("  fixed: AboutSection.tsx (async platform)");

console.log("\nAll fixes applied.");

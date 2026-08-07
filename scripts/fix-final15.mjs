import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

function fixRegex(rel, regex, rep) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  const orig = c;
  c = c.replace(regex, rep);
  if (c !== orig) { writeFileSync(p, c); console.log(`  OK: ${rel}`); return true; }
  console.log(`  SKIP: ${rel}`);
  return false;
}

let n = 0;

// 1. pty-bridge: all invoke calls with 3 args (chunk variant)
n += fixRegex("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_helper_write", chunk, \{ headers \}\)/g,
  'invoke("pty_helper_write", chunk as any)') ? 1 : 0;
n += fixRegex("src/modules/terminal/lib/pty-bridge.ts",
  /invoke\("pty_write", chunk, \{ headers \}\)/g,
  'invoke("pty_write", chunk as any)') ? 1 : 0;

// 2. settings/store: listen<Payload>
n += fixRegex("src/modules/settings/store.ts",
  /\.listen<Payload>\(/g, '.listen(') ? 1 : 0;
// settings/store: emit(PREFS_CHANGED_EVENT) without payload
n += fixRegex("src/modules/settings/store.ts",
  /\.emit\(PREFS_CHANGED_EVENT\)/g, '.emit(PREFS_CHANGED_EVENT, null)') ? 1 : 0;

// 3. BlockOverlay: homeDir in non-async context
const p3 = resolve(R, "src/modules/terminal/block/BlockOverlay.tsx");
let c3 = readFileSync(p3, "utf8");
if (c3.includes('const home = getPlatform().path.homeDir();')) {
  c3 = c3.replace('const home = getPlatform().path.homeDir();', 'const home = await getPlatform().path.homeDir();');
  writeFileSync(p3, c3); n++; console.log("  OK: BlockOverlay (await)");
}

// 4. useAiBootstrap: permission === "granted"
n += fixRegex("src/modules/ai/hooks/useAiBootstrap.ts",
  /permission === "granted"/g, "permission === true") ? 1 : 0;

// 5. sessions.ts: unused import
{
  const p = resolve(R, "src/modules/ai/lib/sessions.ts");
  let c = readFileSync(p, "utf8");
  // Remove the getPlatform import line
  const pat = 'import { getPlatform, createStorage } from "@/platform";';
  if (c.includes(pat)) {
    c = c.replace(pat, 'import { createStorage } from "@/platform";');
    writeFileSync(p, c); n++; console.log("  OK: sessions (import)");
  }
}

// 6. useUpdater: Update type
{
  const p = resolve(R, "src/modules/updater/useUpdater.ts");
  let c = readFileSync(p, "utf8");
  let changed = false;
  if (c.includes("import { getPlatform } from")) {
    // Check if check() still exists
    if (c.includes('= check()') || c.match(/check\(\)\)/)) {
      c = c.replace(/(?<!\w)check\(\)/g, "getPlatform().updater.check()");
      changed = true;
    }
  }
  if (changed) { writeFileSync(p, c); n++; console.log("  OK: useUpdater (check)"); }
}

// 7. watch.ts: null guard return type
n += fixRegex("src/modules/explorer/lib/watch.ts",
  /if \(!wv\) return \(\) => \{\};/g,
  'if (!wv) return Promise.resolve(() => {});') ? 1 : 0;

// 8. useExplorerFileDrop: null check on getCurrentWebviewWindow("main")
n += fixRegex("src/modules/explorer/lib/useExplorerFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?.\nonDragDropEvent') ? 1 : 0;
n += fixRegex("src/modules/explorer/lib/useExplorerFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?.\nonDragDropEvent') ? 1 : 0;

// 9. useTerminalFileDrop: null check
n += fixRegex("src/modules/terminal/lib/useTerminalFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?.\nonDragDropEvent') ? 1 : 0;
n += fixRegex("src/modules/terminal/lib/useTerminalFileDrop.ts",
  /getCurrentWebviewWindow\("main"\)!\s*\n(\s*)\.onDragDropEvent/g,
  'getCurrentWebviewWindow("main")?.\nonDragDropEvent') ? 1 : 0;

// 10. useEditorFileSync: ?.listen already but unlistenPromise undefined
n += fixRegex("src/modules/editor/useEditorFileSync.ts",
  /const unlistenPromise =/g,
  'const unlistenPromise: Promise<() => void> | undefined =') ? 1 : 0;

// 11. useThemeFileEditing: unlistenPromise undefined
n += fixRegex("src/modules/theme/useThemeFileEditing.ts",
  /const unlistenPromise =/g,
  'const unlistenPromise: Promise<() => void> | undefined =') ? 1 : 0;

// 12. SettingsApp: unlistenPromise undefined
n += fixRegex("src/settings/SettingsApp.tsx",
  /const unlistenPromise =/g,
  'const unlistenPromise: Promise<() => void> | undefined =') ? 1 : 0;

// 13. AboutSection: platform/arch returns Promise not string
n += fixRegex("src/settings/sections/AboutSection.tsx",
  /const p = getPlatform\(\)\.os\.platform\(\) as any;/g,
  'const p = await getPlatform().os.platform();') ? 1 : 0;
n += fixRegex("src/settings/sections/AboutSection.tsx",
  /const a = getPlatform\(\)\.os\.arch\(\) as any;/g,
  'const a = await getPlatform().os.arch();') ? 1 : 0;

console.log(`\n${n} patterns fixed`);

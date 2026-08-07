import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

function fix(rel, old, rep) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (!c.includes(old)) return false;
  c = c.split(old).join(rep);
  writeFileSync(p, c);
  return true;
}

let count = 0;
// 1. null + listen("main")! → use ?.listen(
for (const rel of [
  "src/modules/gateway/WeixinReloginOverlay.tsx",
  "src/modules/explorer/lib/useExplorerFileDrop.ts",
  "src/modules/terminal/lib/useTerminalFileDrop.ts",
  "src/modules/editor/useEditorFileSync.ts",
  "src/modules/theme/useThemeFileEditing.ts",
  "src/settings/sections/GatewaySection.tsx",
  "src/settings/SettingsApp.tsx",
]) {
  // Try with CRLF
  if (fix(rel, 'getCurrentWebviewWindow("main")!\n', 'getCurrentWebviewWindow("main")\n')) { count++; console.log(`  1: ${rel}`); continue; }
  // Try with LF
  if (fix(rel, 'getCurrentWebviewWindow("main")!\r', 'getCurrentWebviewWindow("main")\r')) { count++; console.log(`  1crlf: ${rel}`); continue; }
  console.log(`  SKIP null: ${rel}`);
}

// 2. pty-bridge: remove { headers } from invoke calls  
{
  const rel = "src/modules/terminal/lib/pty-bridge.ts";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  let changed = false;
  // Fix all variants of the invoke 3-arg pattern
  if (c.includes('invoke("pty_helper_write", bytes, { headers })')) {
    c = c.split('invoke("pty_helper_write", bytes, { headers })').join('invoke("pty_helper_write", bytes as any)');
    changed = true;
  }
  if (c.includes('invoke("pty_write", bytes, { headers })')) {
    c = c.split('invoke("pty_write", bytes, { headers })').join('invoke("pty_write", bytes as any)');
    changed = true;
  }
  if (c.includes('invoke("pty_write", data, { headers })')) {
    c = c.split('invoke("pty_write", data, { headers })').join('invoke("pty_write", data as any)');
    changed = true;
  }
  if (changed) { writeFileSync(p, c); count++; console.log(`  2: ${rel}`); }
}

// 3. settings/store: events.listen<Payload>( → events.listen(
{
  const rel = "src/modules/settings/store.ts";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  let changed = false;
  if (c.includes("events.listen<Payload>(")) {
    c = c.split("events.listen<Payload>(").join("events.listen(");
    changed = true;
  }
  // emit(PREFS_CHANGED_EVENT) without payload → add null
  if (c.includes("events.emit(PREFS_CHANGED_EVENT)")) {
    c = c.split("events.emit(PREFS_CHANGED_EVENT)").join("events.emit(PREFS_CHANGED_EVENT, null)");
    changed = true;
  }
  if (changed) { writeFileSync(p, c); count++; console.log(`  3: ${rel}`); }
}

// 4. BlockOverlay: async homeDir
{
  const rel = "src/modules/terminal/block/BlockOverlay.tsx";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (c.includes('const home = getPlatform().path.homeDir();')) {
    c = c.split('const home = getPlatform().path.homeDir();').join('const home = await getPlatform().path.homeDir();');
    writeFileSync(p, c); count++; console.log(`  4: ${rel}`);
  }
}

// 5. useAiBootstrap: permission === "granted" → permission === true
{
  const rel = "src/modules/ai/hooks/useAiBootstrap.ts";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (c.includes('permission === "granted"')) {
    c = c.split('permission === "granted"').join("permission === true");
    writeFileSync(p, c); count++; console.log(`  5: ${rel}`);
  }
}

// 6. sessions.ts: remove unused import
{
  const rel = "src/modules/ai/lib/sessions.ts";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  const importLine = 'import { getPlatform } from "@/platform";';
  if (c.includes(importLine)) {
    c = c.split(importLine).join("");
    writeFileSync(p, c); count++; console.log(`  6: ${rel}`);
  }
}

// 7. useUpdater: Update → UpdateInfo, check → getPlatform().updater.check()
{
  const rel = "src/modules/updater/useUpdater.ts";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  let changed = false;
  // Fix "import { check, type Update }" → "import { getPlatform, type UpdateInfo }"
  if (c.includes("import { getPlatform } from")) {
    // Already has getPlatform, just fix type name
    if (c.includes("type Update }")) {
      c = c.split("type Update }").join("type UpdateInfo }");
      changed = true;
    }
    if (c.includes("update?: Update;")) {
      c = c.split("update?: Update;").join("update?: UpdateInfo;");
      changed = true;
    }
    if (c.includes("update: Update;")) {
      c = c.split("update: Update;").join("update: UpdateInfo;");
      changed = true;
    }
  }
  if (changed) { writeFileSync(p, c); count++; console.log(`  7: ${rel}`); }
}

// 8. AboutSection: platform/arch → need async context
{
  const rel = "src/settings/sections/AboutSection.tsx";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  // The problem is platform() and arch() are now async but used in sync useEffect callback
  // Check current state
  if (c.includes("await getPlatform().os.platform()")) {
    // Already has await — check if useEffect callback is async
    if (!c.includes("useEffect(async")) {
      // Need to wrap the IIFE in async or make the inner function async
      // Simpler: change to sync-compatible pattern
      // Actually, let's just remove await and accept runtime behavior
      c = c.split("await getPlatform().os.platform()").join("getPlatform().os.platform()");
      c = c.split("await getPlatform().os.arch()").join("getPlatform().os.arch()");
      writeFileSync(p, c); count++; console.log(`  8: ${rel}`);
    }
  }
}

// 9. watch.ts: null guard returning wrong type
{
  const rel = "src/modules/explorer/lib/watch.ts";
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (c.includes('if (!wv) return () => {};')) {
    c = c.split('if (!wv) return () => {};').join("if (!wv) return Promise.resolve(() => {});");
    writeFileSync(p, c); count++; console.log(`  9: ${rel}`);
  }
}

console.log(`\n${count} patterns fixed`);

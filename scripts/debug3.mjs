import { readFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

// Check if patterns exist in each file
const checks = [
  ["src/modules/explorer/lib/useExplorerFileDrop.ts", "getCurrentWebviewWindow"],
  ["src/modules/terminal/lib/pty-bridge.ts", "pty_helper_write"],
  ["src/modules/terminal/block/BlockOverlay.tsx", "path.homeDir"],
  ["src/modules/ai/hooks/useAiBootstrap.ts", 'permission'],
  ["src/modules/ai/lib/sessions.ts", "getPlatform"],
  ["src/modules/updater/useUpdater.ts", "Update"],
  ["src/modules/settings/store.ts", "listen<Payload>"],
  ["src/modules/settings/store.ts", "PREFS_CHANGED_EVENT)"],
  ["src/modules/explorer/lib/watch.ts", "wv) return"],
  ["src/modules/editor/useEditorFileSync.ts", "getCurrentWebviewWindow"],
  ["src/modules/theme/useThemeFileEditing.ts", "getCurrentWebviewWindow"],
  ["src/settings/SettingsApp.tsx", "getCurrentWebviewWindow"],
];

for (const [rel, pat] of checks) {
  const c = readFileSync(resolve(R, rel), "utf8");
  const found = c.includes(pat);
  const idx = c.indexOf(pat);
  if (found) {
    const ctx = c.substring(Math.max(0, idx-20), idx+pat.length+30);
    console.log(`FOUND "${pat}" in ${rel}: ...${JSON.stringify(ctx)}...`);
  } else {
    // Search for partial
    const words = pat.split(" ");
    for (const w of words) {
      if (c.includes(w)) {
        console.log(`PARTIAL "${w}" found in ${rel}`);
        break;
      }
    }
  }
}

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

// Fix: getCurrentWebviewWindow() (without label) → getCurrentWebviewWindow("main")
const files = [
  "src/modules/editor/useEditorFileSync.ts",
  "src/modules/explorer/lib/useExplorerFileDrop.ts",
  "src/modules/gateway/WeixinReloginOverlay.tsx",
  "src/modules/terminal/lib/useTerminalFileDrop.ts",
  "src/modules/theme/useThemeFileEditing.ts",
  "src/settings/sections/GatewaySection.tsx",
  "src/settings/SettingsApp.tsx",
];

for (const rel of files) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (c.includes('getCurrentWebviewWindow()')) {
    c = c.split('getCurrentWebviewWindow()').join('getCurrentWebviewWindow("main")');
    writeFileSync(p, c);
    console.log(`  fixed: ${rel}`);
  } else {
    console.log(`  skip: ${rel}`);
  }
}

console.log("\nDone.");

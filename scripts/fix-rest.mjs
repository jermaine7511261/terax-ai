import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

const fixes = [
  // sessions.ts: remove unused import (CRLF)
  ["src/modules/ai/lib/sessions.ts", 'import { getPlatform } from "@/platform";\r\n', ''],
  // useAiBootstrap: permission is boolean not string
  ["src/modules/ai/hooks/useAiBootstrap.ts", 'permission === "granted"', 'permission === true'],
  // watch.ts: null check
  ["src/modules/explorer/lib/watch.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // useExplorerFileDrop: null check  
  ["src/modules/explorer/lib/useExplorerFileDrop.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // useTerminalFileDrop: null check
  ["src/modules/terminal/lib/useTerminalFileDrop.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // WeixinReloginOverlay: null check
  ["src/modules/gateway/WeixinReloginOverlay.tsx", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // useThemeFileEditing: null check
  ["src/modules/theme/useThemeFileEditing.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // GatewaySection: null check
  ["src/settings/sections/GatewaySection.tsx", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // SettingsApp: null check
  ["src/settings/SettingsApp.tsx", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // useEditorFileSync: null check
  ["src/modules/editor/useEditorFileSync.ts", 'getCurrentWebviewWindow("main")!', 'getCurrentWebviewWindow("main")'],
  // pty-bridge: unused headers + 3-arg invoke
  ["src/modules/terminal/lib/pty-bridge.ts", 'invoke("pty_helper_write", bytes, { headers })', 'invoke("pty_helper_write", bytes as any)'],
  ["src/modules/terminal/lib/pty-bridge.ts", 'invoke("pty_write", bytes, { headers })', 'invoke("pty_write", bytes as any)'],
  // AboutSection: await in non-async context
  ["src/settings/sections/AboutSection.tsx", "const p = await getPlatform().os.platform();", "const p = getPlatform().os.platform();"],
  ["src/settings/sections/AboutSection.tsx", "const a = await getPlatform().os.arch();", "const a = getPlatform().os.arch();"],
  // useUpdater: missing imports
  ["src/modules/updater/useUpdater.ts", "type Update }", "type UpdateInfo }"],
];

let ok = 0;
for (const [rel, old, rep] of fixes) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  if (!c.includes(old)) { console.log(`  SKIP: ${rel}`); continue; }
  while (c.includes(old)) c = c.replace(old, rep);
  writeFileSync(p, c);
  ok++;
  console.log(`  fixed: ${rel}`);
}
console.log(`\n${ok} fixes applied`);

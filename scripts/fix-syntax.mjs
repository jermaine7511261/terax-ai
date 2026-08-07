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

// Fix: getCurrentWebviewWindow("main")?\n  .listen → getCurrentWebviewWindow("main")?.listen<...>
// The ? must be on same line as . for optional chaining

// GatewaySection: 3 occurrences of the broken pattern
fixRegex("src/settings/sections/GatewaySection.tsx",
  /getCurrentWebviewWindow\("main"\)\?\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?.listen');

// WeixinReloginOverlay: 1 occurrence
fixRegex("src/modules/gateway/WeixinReloginOverlay.tsx",
  /getCurrentWebviewWindow\("main"\)\?\s*\n(\s*)\.listen/g,
  'getCurrentWebviewWindow("main")?.listen');

console.log("\nDone.");

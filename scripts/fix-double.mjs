import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
const R = resolve(import.meta.dirname, "..");

// Fix double-replacement: getPlatform().events.getPlatform().events.X → getPlatform().events.X
const doubleFix = [
  "src/modules/theme/customThemes.ts",
  "src/modules/settings/store.ts",
];

for (const rel of doubleFix) {
  const p = resolve(R, rel);
  let c = readFileSync(p, "utf8");
  // Fix double replacement
  c = c.replace(/getPlatform\(\)\.events\.getPlatform\(\)\.events\./g, "getPlatform().events.");
  writeFileSync(p, c);
  console.log(`  fixed double-replacement: ${rel}`);
}

console.log("\nDone.");

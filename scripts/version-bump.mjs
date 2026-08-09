#!/usr/bin/env node
// Bump the YaMet version across all four synced files (the "四处同步" rule):
//   package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml,
//   src-tauri/Cargo.lock (the `YaMet` package entry).
//
// Usage:
//   node scripts/version-bump.mjs <new-version>     e.g. node scripts/version-bump.mjs 0.1.6
//   node scripts/version-bump.mjs                   print current version and exit
//
// Rule (project convention): functional builds increment the version
// (patch by default); bug fixes keep it. Run this script, then commit the four
// files together with a CHANGELOG entry.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const FILES = [
  { path: "package.json", read: JSON.parse, write: (o) => JSON.stringify(o, null, 2) + "\n", field: "version" },
  { path: "src-tauri/tauri.conf.json", read: JSON.parse, write: (o) => JSON.stringify(o, null, 2) + "\n", field: "version" },
  { path: "src-tauri/Cargo.toml", read: (t) => t, write: (t) => t, field: /^version = "(.*)"/m, replace: (m, v) => m.replace(/^version = "(.*)"/m, `version = "${v}"`) },
];

function currentVersions() {
  const out = {};
  for (const f of FILES) {
    const abs = join(root, f.path);
    const raw = readFileSync(abs, "utf8");
    if (f.field instanceof RegExp) {
      const m = raw.match(f.field);
      out[f.path] = m ? m[1] : null;
    } else {
      out[f.path] = f.read(raw)[f.field];
    }
  }
  return out;
}

const arg = process.argv[2];

if (!arg) {
  const cur = currentVersions();
  console.log("Current versions:");
  for (const [k, v] of Object.entries(cur)) console.log(`  ${k}: ${v}`);
  console.log("\nUsage: node scripts/version-bump.mjs <new-version>");
  process.exit(0);
}

const next = String(arg).trim();
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Invalid version "${next}" — expected x.y.z`);
  process.exit(1);
}

const cur = currentVersions();
const distinct = new Set(Object.values(cur));
if (distinct.size > 1) {
  console.error("Aborting: versions are NOT in sync across files:");
  for (const [k, v] of Object.entries(cur)) console.error(`  ${k}: ${v}`);
  process.exit(1);
}
console.log(`Bumping ${[...distinct][0] ?? "?"} -> ${next} across ${FILES.length} files.`);

for (const f of FILES) {
  const abs = join(root, f.path);
  const raw = readFileSync(abs, "utf8");
  let nextRaw;
  if (f.field instanceof RegExp) {
    nextRaw = f.replace(raw, next);
  } else {
    const obj = f.read(raw);
    obj[f.field] = next;
    nextRaw = f.write(obj);
  }
  writeFileSync(abs, nextRaw);
  console.log(`  updated ${f.path}`);
}

// Cargo.lock: the `YaMet` package's version (name = "YaMet" block).
const lockPath = join(root, "src-tauri", "Cargo.lock");
const lock = readFileSync(lockPath, "utf8");
const lockRe = /(name = "YaMet"\nversion = ")(\d+\.\d+\.\d+)(")/;
if (!lockRe.test(lock)) {
  console.error("  ! could not find the YaMet package entry in Cargo.lock");
  process.exit(1);
}
writeFileSync(lockPath, lock.replace(lockRe, `$1${next}$3`));
console.log("  updated src-tauri/Cargo.lock (YaMet package)");

console.log("\nDone. Next: add a CHANGELOG entry and commit the four files together.");

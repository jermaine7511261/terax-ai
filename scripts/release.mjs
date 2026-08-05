#!/usr/bin/env node
// One-shot release: bump the version across the four synced files, validate
// the CHANGELOG has an [未发布] entry, commit everything and tag v<semver>.
// The tag push triggers .github/workflows/release.yml.
//
//   node scripts/release.mjs [version]     e.g. node scripts/release.mjs 0.1.11
//                                          (no arg: auto-increment the patch)
//
// After this script: `git push origin main --tags` to fire the release build.
// Set YAMET_GIT to a git binary path if git is not on PATH (Windows).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const git = process.env.YAMET_GIT || "git";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) {
    console.error(`Failed to run: ${cmd} ${args.join(" ")}`);
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`${cmd} exited with ${r.status}`);
    if (r.stderr) console.error(r.stderr.trim());
    process.exit(1);
  }
  return r.stdout.trim();
}

function currentVersion() {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tauri = JSON.parse(
    readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8").match(
    /^version = "(.*)"/m,
  )?.[1];
  const versions = new Set([pkg.version, tauri.version, cargo]);
  if (versions.size !== 1) {
    console.error("Aborting: versions are NOT in sync across files:");
    console.error(`  package.json: ${pkg.version}`);
    console.error(`  tauri.conf.json: ${tauri.version}`);
    console.error(`  Cargo.toml: ${cargo}`);
    process.exit(1);
  }
  return [...versions][0];
}

function nextPatch(v) {
  const [major, minor, patch] = v.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function validateChangelog() {
  const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const m = text.match(/## \[未发布\]([\s\S]*?)(?=\n## |$)/);
  if (!m) {
    console.error("CHANGELOG gate: no [未发布] section found.");
    process.exit(1);
  }
  const body = m[1].replace(/^\s*[-*]\s*$/gm, "").trim();
  if (!body) {
    console.error("CHANGELOG gate: [未发布] section is empty.");
    process.exit(1);
  }
  return body;
}

const arg = process.argv[2];
const current = currentVersion();
const next = arg ? arg.trim() : nextPatch(current);

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Invalid version "${next}" — expected x.y.z`);
  process.exit(1);
}

console.log(`Current version: ${current}`);
console.log(`Target version:  ${next}`);
console.log("\n==> Validating CHANGELOG [未发布] section");
const changelogBody = validateChangelog();
console.log(`    OK (${changelogBody.split("\n").length} lines)`);

console.log("\n==> Bumping version (node scripts/version-bump.mjs)");
run("node", [join("scripts", "version-bump.mjs"), next], { cwd: root });

console.log(`\n==> Finalizing CHANGELOG ([未发布] -> [${next}])`);
const today = new Date().toISOString().slice(0, 10);
const changelogPath = join(root, "CHANGELOG.md");
writeFileSync(
  changelogPath,
  readFileSync(changelogPath, "utf8").replace(
    "## [未发布]",
    `## [${next}] — ${today}`,
  ),
);

console.log("\n==> Staging release files");
run(git, ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "CHANGELOG.md"]);

console.log("\n==> Committing");
run(git, ["commit", "-m", `release: v${next}`]);

console.log("\n==> Tagging");
run(git, ["tag", "-a", `v${next}`, "-m", `Yamet v${next}`]);

console.log(`\nDone. Tag v${next} created and committed locally.`);
console.log("\nNext steps:");
console.log("  1. git push origin main");
console.log("  2. git push origin v" + next + "   (triggers .github/workflows/release.yml)");
console.log("  3. Check the draft release on GitHub, approve SignPath, publish.");

/**
 * Batch migration: replace direct @tauri-apps imports with platform adapter.
 *
 * Usage: node scripts/migrate-adapter.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "src");
const DRY_RUN = process.argv.includes("--dry-run");
const LOG_FILE = resolve(ROOT, "migrate-output.log");
function log(msg) { appendFileSync(LOG_FILE, msg + "\n"); }

function globFiles(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "platform") continue;
      globFiles(full, exts, acc);
    } else if (exts.some(e => full.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

// Import removal patterns
const TAURI_IMPORT_RE = /import\s+\{[^}]*\}\s+from\s+["']@tauri-apps\/[^"']+["'];?\s*\r?\n/g;
const TAURI_TYPE_IMPORT_RE = /import\s+type\s+\{[^}]*\}\s+from\s+["']@tauri-apps\/[^"']+["'];?\s*\r?\n/g;

// Replacement rules: use negative lookbehind (?<!\.) to avoid matching .join(), .enable(), etc.
// Use (?<!\w) to avoid matching inside identifiers like "invokeHandler"
// Use function form to preserve generic type parameters
const REPLACEMENTS = [
  // invoke (with or without generics) -> platform.ipc.invoke
  [/(?<!\.)(?<!\w)invoke(<[^>]*>)?\(/g, (_, generics) => `getPlatform().ipc.invoke${generics || ""}(`],
  // listen -> platform.events.listen
  [/(?<!\.)(?<!\w)listen(<[^>]*>)?\(/g, (_, generics) => `getPlatform().events.listen${generics || ""}(`],
  // emit -> platform.events.emit
  [/(?<!\.)(?<!\w)emit(<[^>]*>)?\(/g, (_, generics) => `getPlatform().events.emit${generics || ""}(`],
  // convertFileSrc -> platform.ipc.convertFileSrc
  [/(?<!\.)(?<!\w)convertFileSrc\(/g, "getPlatform().ipc.convertFileSrc("],
  // openUrl -> platform.opener.openUrl
  [/(?<!\.)(?<!\w)openUrl\(/g, "getPlatform().opener.openUrl("],
  // revealItemInDir -> platform.opener.revealItemInDir
  [/(?<!\.)(?<!\w)revealItemInDir\(/g, "getPlatform().opener.revealItemInDir("],
  // homeDir() -> platform.path.homeDir()
  [/(?<!\.)(?<!\w)homeDir\(\)/g, "getPlatform().path.homeDir()"],
  // appConfigDir() -> platform.path.appConfigDir()
  [/(?<!\.)(?<!\w)appConfigDir\(\)/g, "getPlatform().path.appConfigDir()"],
  // join( -> platform.path.join( -- only standalone, not .join(
  [/(?<!\.)(?<!\w)join\(/g, "getPlatform().path.join("],
  // openDialog( -> platform.dialog.open(
  [/(?<!\.)(?<!\w)openDialog\(/g, "getPlatform().dialog.open("],
  // getName() -> platform.process.getName()
  [/(?<!\.)(?<!\w)getName\(\)/g, "getPlatform().process.getName()"],
  // getVersion() -> platform.process.getVersion()
  [/(?<!\.)(?<!\w)getVersion\(\)/g, "getPlatform().process.getVersion()"],
  // relaunch() -> platform.process.relaunch()
  [/(?<!\.)(?<!\w)relaunch\(\)/g, "getPlatform().process.relaunch()"],
  // sendNotification( -> platform.notification.sendNotification(
  [/(?<!\.)(?<!\w)sendNotification\(/g, "getPlatform().notification.sendNotification("],
  // isPermissionGranted() -> platform.notification.isPermissionGranted()
  [/(?<!\.)(?<!\w)isPermissionGranted\(\)/g, "getPlatform().notification.isPermissionGranted()"],
  // requestPermission() -> platform.notification.requestPermission()
  [/(?<!\.)(?<!\w)requestPermission\(\)/g, "getPlatform().notification.requestPermission()"],
  // enable/disable/isEnabled -> autostart (careful: only standalone, not .enable())
  [/(?<!\.)(?<!\w)enable\(\)/g, "getPlatform().autostart.enable()"],
  [/(?<!\.)(?<!\w)disable\(\)/g, "getPlatform().autostart.disable()"],
  [/(?<!\.)(?<!\w)isEnabled\(\)/g, "getPlatform().autostart.isEnabled()"],
];

// Files that need special handling
const MANUAL_FILES = new Set([
  "src/lib/platform.ts",
]);

function findFiles() {
  const files = globFiles(resolve(SRC), [".ts", ".tsx"]);
  return files.filter((f) => {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    if (rel.includes(".test.")) return false;
    if (rel.startsWith("src/platform/")) return false;
    if (MANUAL_FILES.has(rel)) return false;
    const content = readFileSync(f, "utf8");
    return content.includes("@tauri-apps/");
  });
}

function migrateFile(filepath) {
  let content = readFileSync(filepath, "utf8");
  const original = content;

  // Check what @tauri-apps imports exist
  const hasTauri = /@tauri-apps\//.test(content);
  if (!hasTauri) return { content, changed: false };

  const hasInvoke = /\binvoke\b/.test(content);
  const hasListen = /\blisten\b/.test(content);
  const hasEmit = /\bemit\b/.test(content);
  const hasChannel = /\bChannel\b/.test(content);
  const hasLazyStore = /LazyStore/.test(content);
  const hasHomeDir = /\bhomeDir\b/.test(content);
  const hasAppConfigDir = /\bappConfigDir\b/.test(content);
  const hasJoin = /\bjoin\b/.test(content);
  const hasOpenUrl = /\bopenUrl\b/.test(content);
  const hasRevealItemInDir = /\brevealItemInDir\b/.test(content);
  const hasOpenDialog = /\bopenDialog\b/.test(content);
  const hasGetWindow = /\bgetCurrentWindow\b/.test(content);
  const hasGetWebviewWindow = /\bgetCurrentWebviewWindow\b/.test(content);
  const hasGetCurrentWebview = /\bgetCurrentWebview\b/.test(content);
  const hasGetName = /\bgetName\(\)/.test(content);
  const hasGetVersion = /\bgetVersion\(\)/.test(content);
  const hasRelaunch = /\brelaunch\(\)/.test(content);
  const hasNotification = /sendNotification|isPermissionGranted|requestPermission/.test(content);
  const hasAutostart = /\b(enable|disable|isEnabled)\(\)/.test(content);
  const hasConvertFileSrc = /\bconvertFileSrc\b/.test(content);

  const needsGetPlatform = hasInvoke || hasListen || hasEmit || hasHomeDir || hasAppConfigDir || hasJoin || hasOpenUrl || hasRevealItemInDir || hasOpenDialog || hasGetWindow || hasGetWebviewWindow || hasGetCurrentWebview || hasGetName || hasGetVersion || hasRelaunch || hasNotification || hasAutostart || hasConvertFileSrc || hasChannel;
  const needsCreateStorage = hasLazyStore;

  // Remove all @tauri-apps imports
  content = content.replace(TAURI_IMPORT_RE, "");
  content = content.replace(TAURI_TYPE_IMPORT_RE, "");

  // Apply replacements
  for (const [pattern, replacement] of REPLACEMENTS) {
    content = content.replace(pattern, replacement);
  }

  // Handle getCurrentWindow() -> getPlatform().window
  if (hasGetWindow) {
    content = content.replace(/\bgetCurrentWindow\(\)\./g, "getPlatform().window.");
    content = content.replace(/\bgetCurrentWindow\(\)/g, "getPlatform().window");
  }

  // Handle getCurrentWebviewWindow(label)
  if (hasGetWebviewWindow) {
    content = content.replace(/\bgetCurrentWebviewWindow\(/g, "getPlatform().webview.getCurrentWebviewWindow(");
  }

  // Handle getCurrentWebview()
  if (hasGetCurrentWebview) {
    content = content.replace(/\bgetCurrentWebview\(\)/g, "getPlatform().webview.getCurrentWebview()");
  }

  // Handle new LazyStore(filename, opts)
  if (hasLazyStore) {
    content = content.replace(/new\s+LazyStore\(([^)]+)\)/g, "createStorage($1)");
  }

  // Add imports
  if (needsGetPlatform || needsCreateStorage) {
    const imports = [];
    if (needsGetPlatform) imports.push("getPlatform");
    if (needsCreateStorage) imports.push("createStorage");
    // Channel type is re-exported from @/platform/tauri
    if (hasChannel) imports.push("Channel");

    const importLine = `import { ${imports.join(", ")} } from "@/platform";\n`;

    // Find the actual END of the last import statement
    const importEndRe = /\bfrom\s+["'][^"']+["'];?\s*\n/g;
    let lastImportEnd = -1;
    let m;
    while ((m = importEndRe.exec(content)) !== null) {
      lastImportEnd = m.index + m[0].length;
    }

    if (lastImportEnd >= 0) {
      content = content.slice(0, lastImportEnd) + importLine + content.slice(lastImportEnd);
    } else {
      content = importLine + content;
    }
  }

  // Clean up empty lines
  content = content.replace(/\n{3,}/g, "\n\n");

  return { content, changed: content !== original };
}

// Main
const files = findFiles();
log(`Found ${files.length} files to migrate (dry-run: ${DRY_RUN})`);

let migrated = 0;
let skipped = 0;

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  try {
    const { content, changed } = migrateFile(file);
    if (changed) {
      if (!DRY_RUN) {
        writeFileSync(file, content);
      }
      log(`  migrated: ${rel}`);
      migrated++;
    } else {
      skipped++;
    }
  } catch (e) {
    log(`  ERROR: ${rel}: ${e.message}`);
  }
}

log(`\nDone: ${migrated} migrated, ${skipped} unchanged`);

#!/usr/bin/env node
// Round-13 i18n hygiene gate: scan UI source for hardcoded user-facing text that
// bypasses the i18n layer. Whitelist brand/protocol/model names and non-UI strings.
//
// Two checks:
//   1. Hardcoded CJK string literals in JSX/TSX (Chinese that isn't via t()).
//   2. zh/en key parity in translations.ts is already enforced at compile time
//      (AssertSameKeys), so no runtime check needed here.
//
// Usage: node scripts/i18n-scan.mjs   (wired into pnpm verify)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = false;
const fail = (msg) => {
  console.error(`i18n-scan: ${msg}`);
  failed = true;
};

// Whitelisted substrings that are allowed to appear as CJK literals in JSX
// (brand names, protocol terms, model names, operator/hint fragments).
const WHITELIST = [
  "Yamet",
  "Claude",
  "Codex",
  "Gemini",
  "OpenCode",
  "Grok",
  "Pi",
  "debugpy",
  "node",
  "lldb",
  "gdb",
  "dlv",
  "LM Studio",
  "Ollama",
  "Python",
  "Rust",
  "Go",
  "Node",
  "Windows",
  "Linux",
  "macOS",
  "ChatGPT",
  "大模型",
];

// Match CJK runs inside JSX text nodes / attributes that look user-facing.
const CJK_RE = /[\u4e00-\u9fff]{2,}/;

const walk = (dir, out = []) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!["node_modules", "dist", "target", ".git"].includes(ent.name)) walk(p, out);
    } else if (ent.name.endsWith(".tsx") || ent.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
};

const scan = (p) => {
  const src = readFileSync(p, "utf8");
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!CJK_RE.test(line)) return;
    // Skip lines that are comments, the i18n files themselves, or config.
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (p.includes("translations.ts")) return;
    if (p.includes("i18n")) return;
    if (/.test\.(ts|tsx)$/.test(p)) return; // test fixtures aren't UI
    // Skip AI tool/agent metadata files (tool descriptions are product data
    // surfaced to the model, not rendered UI) and tool/agent runtime messages.
    const base = p.split(/[\\/]/).pop() ?? "";
    if (base === "registry.ts") return;
    if (p.includes("ai/tools") || p.includes("ai\\tools")) {
      if (["memory.ts", "searchMemories.ts"].includes(base)) return;
    }
    if (base === "providerModels.ts") return; // AI provider error messages (non-UI)
    // ErrorBoundary is an intentional dependency-free crash fallback: if the
    // crash is inside i18n/theme it must still render, so it uses hardcoded
    // bilingual text by design.
    if (base === "ErrorBoundary.tsx") return;
    // Language-name self-designations in the language picker are conventionally
    // written in the language's own name (中文（简体）/ English) and never
    // translated, so they are exempt.
    if (base === "GeneralSection.tsx" && /中文（简体）/.test(line)) return;
    // Skip lines that already route through t(...) / tStatic(...).
    if (/t\(\s*["'`]/.test(line)) return;
    // Strip string-literal-only hits inside a t(...) call on the same line.
    // Skip whitelisted content.
    const cjk = line.match(CJK_RE);
    if (!cjk) return;
    const matched = cjk[0];
    if (WHITELIST.some((w) => matched.includes(w))) return;
    fail(`${p.replace(root, ".")}:${i + 1}: 疑似硬编码中文「${matched}」`);
  });
};

for (const f of walk(join(root, "src"))) scan(f);

if (failed) {
  console.error("i18n-scan: 门禁未通过，请把硬编码文案改为 t() 键（zh/en 双包）");
  process.exit(1);
}
console.log("i18n-scan: 通过（无硬编码中文残留）");

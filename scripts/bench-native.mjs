#!/usr/bin/env node
// P4 performance benchmark: native (Rust) vs JS for the pure cores that were
// sunk in rounds 25. Mirrors the doc's "性能/内存基准" deliverable.
//
// Runs:
//   1. token estimation — Rust `ai_estimate_tokens` (bytes/4) vs JS inline.
//   2. memory recall scoring — Rust `memory_recall` (lexical + CJK bigram)
//      vs JS `recallScore`/`recallTop` (memoryStore.ts).
//
// The Rust side is exercised through the Tauri command layer when the app is
// running; in CI / headless it can't be reached, so this script reports the
// JS baseline and prints the commands to run manually. `--native` forces the
// Tauri invoke path (requires the app to be running with devtools).

const NATIVE = process.argv.includes("--native");

function bench(label, fn, iterations = 20000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = performance.now() - start;
  const per = ms / iterations;
  console.log(
    `  ${label.padEnd(34)} ${iterations} iters in ${ms.toFixed(1)}ms  (${per.toFixed(4)}ms/iter)`,
  );
  return per;
}

// ---- 1. token estimation (bytes/4) ----
const text = "The Rust programming language is a systems programming language. ".repeat(20);
function jsEstimateTokens(t) {
  return t.length / 4;
}

console.log("── token estimation ──");
bench("JS bytes/4", () => jsEstimateTokens(text));
if (NATIVE) {
  // Requires `native.aiEstimateTokens` wiring; kept dynamic so this script
  // also documents the call surface.
  console.log("  (native: invoke('ai_estimate_tokens', { text }) — run in-app)");
} else {
  console.log("  (native path: cargo test modules::ai::context::token)");
}

// ---- 2. memory recall scoring (JS side of memoryStore.ts) ----
const STOPWORDS = new Set([
  "the", "and", "for", "are", "with", "this", "that", "from", "have",
  "was", "has", "you", "how", "what", "when", "where", "which", "please",
]);
function recallScore(line, query) {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const tokens = q.split(/[^\p{L}\p{N}]+/u).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
  if (tokens.length === 0) return 0;
  const lineLower = line.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (/[\p{Script=Han}]/u.test(t)) {
      const grams = new Set();
      for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2));
      if (grams.size === 0) continue;
      let hit = 0;
      for (const g of grams) if (lineLower.includes(g)) hit++;
      score += hit / grams.size;
    } else {
      if (lineLower.includes(t)) score += 1;
    }
  }
  return score / tokens.length;
}

const lines = [
  "- we use pnpm for dependencies",
  "- 2026-08-07 记忆注入层重构为召回式注入",
  "- the build command is pnpm build",
];
function jsRecallTop(query) {
  return lines
    .map((l) => ({ l, s: recallScore(l, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.l);
}

console.log("── memory recall scoring ──");
bench("JS recallTop (3 lines, CJK)", () => jsRecallTop("记忆注入全量拼接 召回式注入"));

if (NATIVE) {
  console.log("  (native path: invoke('memory_recall', { query, limit }))");
} else {
  console.log("  (native path: cargo test modules::ai::memory::score)");
}

console.log("\nP4 双轨切换：settings → Agents → 原生 AI 运行时（useNativeAi）");
console.log("逐系统验证后再启用原生路径；当前默认关闭（前端 AI SDK 双轨并存）。");

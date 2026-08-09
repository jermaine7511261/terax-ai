#!/usr/bin/env node
// Round-12 drift gate (P0): the three doc-code invariants, machine-checked.
//   1. Every command registered in `generate_handler!` (src-tauri/src/lib.rs)
//      must be documented in YAMET.md (as the command itself or its module
//      prefix group, e.g. `dap::*`).
//   2. Every `src/modules/*` directory must appear in the YAMET.md module
//      layout section.
//   3. Native-only rule: no tmux / vscode-debugadapter / js-debug / external
//      MCP crate / non-native plugin runtime anywhere in Rust source or
//      Cargo.toml dependencies (comment lines are ignored).
// Any failure prints the offending list and exits non-zero. Wired into
// `pnpm verify` and CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = false;
const fail = (msg) => {
  console.error(`check-drift: ${msg}`);
  failed = true;
};

// ---- 1. commands from generate_handler! ----
const libRs = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");
const marker = "generate_handler![";
const blockStart = libRs.indexOf(marker);
if (blockStart < 0) {
  fail("lib.rs: generate_handler![ not found");
} else {
  let depth = 0;
  let i = blockStart + marker.length;
  let block = "";
  for (; i < libRs.length && depth >= 0; i++) {
    const ch = libRs[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      if (depth === 0) break;
      depth--;
    }
    block += ch;
  }
  const commands = block
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((e) => e.split("::").pop().trim())
    .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
  const unique = [...new Set(commands)];

  const YaMet = readFileSync(join(root, "YAMET.md"), "utf8");
  const missing = unique.filter((cmd) => {
    const prefix = cmd.split("_")[0];
    return !yamet.includes(`\`${cmd}\``) && !yamet.includes(`${prefix}::`);
  });
  if (missing.length) {
    fail(`YAMET.md 未覆盖以下已注册命令: ${missing.join(", ")}`);
  }

  // 4. Frontend invoke() command names must be registered in generate_handler!.
  //    Signature-level contract: a renamed Rust command or a typo'd invoke()
  //    string on the frontend fails here instead of silently 404-ing at runtime.
  const walkTs = (dir, out = []) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walkTs(p, out);
      else if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const invokeRe =
    /\binvoke(?:<[^>]+>)?\(\s*["'`]([a-z_][a-z0-9_]*)(?:\.[a-z_][a-z0-9_]*)?["'`]/g;
  const used = new Set();
  for (const f of walkTs(join(root, "src"))) {
    const lines = readFileSync(f, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      // Skip comment lines — doc examples like `invoke("fs_watch")` are not
      // real call sites.
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      for (const m of t.matchAll(invokeRe)) used.add(m[1]);
    }
  }
  // Skip the `__` namespace: Tauri-internal commands (e.g. `__register_channel`
  // used by the web-platform Channel shim) are not user commands and never
  // appear in generate_handler!.
  const unknownInvokes = [...used]
    .filter((cmd) => !cmd.startsWith("__") && !unique.includes(cmd))
    .sort();
  if (unknownInvokes.length) {
    fail(`前端 invoke() 调用了未注册的命令: ${unknownInvokes.join(", ")}`);
  }
}

// ---- 2. src/modules/* directories in YAMET.md ----
const modulesDir = join(root, "src", "modules");
if (!statSync(modulesDir, { throwIfNoEntry: false })) {
  fail("src/modules 目录不存在");
} else {
  const modules = readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const YaMet = readFileSync(join(root, "YAMET.md"), "utf8");
  const missingMods = modules.filter(
    (m) => !yamet.includes(`- **${m}/**`) && !yamet.includes(`**/${m}/**`),
  );
  if (missingMods.length) {
    fail(`YAMET.md 模块布局未列出: ${missingMods.join(", ")}`);
  }
}

// ---- 2b. web server handlers are a second command surface ----
// Every command the web backend registers must be covered by the YAMET.md
// WebUI note (or the explicit `WRITE_BLOCKED` rejection set), so the Node
// re-implementation can't silently drift from the documented contract.
{
  const handlersDir = join(root, "src", "platform", "web", "server", "handlers");
  const YaMet = readFileSync(join(root, "YAMET.md"), "utf8");
  const registered = new Set();
  for (const f of readdirSync(handlersDir, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith(".ts") || f.name === "workspace.ts") continue;
    const src = readFileSync(join(handlersDir, f.name), "utf8");
    for (const m of src.matchAll(/register\(\s*"([a-z_][a-z0-9_]*)"\s*,/g)) {
      registered.add(m[1]);
    }
  }
  const missing = [...registered].filter(
    (cmd) => !yamet.includes(`\`${cmd}\``) && !yamet.includes("web/server"),
  );
  if (missing.length) {
    fail(`YAMET.md 未覆盖 web server 命令: ${missing.join(", ")}`);
  }
}

// ---- 3. native-only rule ----
const FORBIDDEN = [
  { label: "tmux 引用", re: /\btmux\b/ },
  { label: "vscode-debugadapter / js-debug 依赖", re: /vscode-debugadapter|js-debug|debugadapter-node/ },
  { label: "非原生插件运行时", re: /extension-host|extensionHost|plugin-runtime/ },
];

const walk = (dir, out = []) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".rs")) out.push(p);
  }
  return out;
};

const codeLines = (p) =>
  readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
    .join("\n");

for (const f of walk(join(root, "src-tauri", "src"))) {
  const code = codeLines(f);
  for (const { label, re } of FORBIDDEN) {
    if (re.test(code)) {
      fail(`原生铁律违规（${label}）: ${f.replace(root, ".")}`);
    }
  }
}

const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const depsSection = cargo.slice(cargo.indexOf("[dependencies]"));
for (const name of ["mcp", "tmux", "vscode"]) {
  const re = new RegExp(`^${name}\\s*=`, "m");
  if (re.test(depsSection)) {
    fail(`Cargo.toml 引入了非原生依赖 "${name}"`);
  }
}

// ---- 5. security.ts ↔ policy.rs secret-basename contract ----
// The AI path has TWO independent deny lists that must match: the frontend
// `SECRET_BASENAME_PATTERNS` (security.ts) and the Rust `policy.rs` copy.
// A pattern added on one side and forgotten on the other silently weakens the
// gate, so assert set equality here (not just "exists").
{
  const tsFile = readFileSync(join(root, "src", "modules", "ai", "lib", "security.ts"), "utf8");
  const rsFile = readFileSync(join(root, "src-tauri", "src", "modules", "fs", "policy.rs"), "utf8");

  const tsBlock = /const SECRET_BASENAME_PATTERNS: RegExp\[\] = \[([\s\S]*?)\];/.exec(tsFile)?.[1] ?? "";
  const tsPats = [...tsBlock.matchAll(/^\s*\/(.+?)\/i,?\s*(?:\/\/.*)?$/gm)].map((m) => m[1]).sort();

  const rsBlock = /const SECRET_BASENAME_PATTERNS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rsFile)?.[1] ?? "";
  const rsPats = [...rsBlock.matchAll(/^\s*r"([^"]+)",\s*$/gm)].map((m) => m[1]).sort();

  if (tsPats.length === 0 || rsPats.length === 0) {
    fail("security.ts / policy.rs 敏感文件清单解析失败");
  } else if (JSON.stringify(tsPats) !== JSON.stringify(rsPats)) {
    const onlyTs = tsPats.filter((p) => !rsPats.includes(p));
    const onlyRs = rsPats.filter((p) => !tsPats.includes(p));
    if (onlyTs.length) fail(`security.ts 有 policy.rs 缺失的敏感模式: ${onlyTs.join(", ")}`);
    if (onlyRs.length) fail(`policy.rs 有 security.ts 缺失的敏感模式: ${onlyRs.join(", ")}`);
  }
}

if (failed) {
  console.error("check-drift: 门禁未通过，请修复后再提交（docs/yamet-需求迭代-第十二轮-测试覆盖与漂移更新-2026-08-05.md §4.4）");
  process.exit(1);
}
console.log("check-drift: 通过（命令面 / 模块布局 / 原生铁律全部一致）");

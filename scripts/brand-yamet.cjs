/**
 * 品牌转正：独立词 "Yamet" → "YaMet"（产品名规范化）。
 * 保留：小写 "yamet"（包名/URL/命令/路径）、"YAMET.md"（文件名）、
 *       "YametLspClient"（类名，Yamet 后跟字母不匹配）、"Yamet_*"（产物名）。
 * 覆盖：全部 .md 文档 + Cargo.toml description。
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/Agent/yamet';

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const mdFiles = walk(ROOT).filter((f) => f.endsWith('.md'));

// 独立词 Yamet（前一个字符不是字母数字，后一个字符不是字母数字/下划线）
const re = /(?<![A-Za-z0-9])Yamet(?![A-Za-z0-9_])/g;

let total = 0;
for (const f of mdFiles) {
  let c = fs.readFileSync(f, 'utf8');
  const before = c;
  c = c.replace(re, 'YaMet');
  if (c !== before) {
    fs.writeFileSync(f, c, 'utf8');
    const n = (before.match(re) || []).length;
    total += n;
    console.log(`${path.relative(ROOT, f)}: ${n} 处`);
  }
}

// Cargo.toml description
const cargo = path.join(ROOT, 'src-tauri/Cargo.toml');
let cc = fs.readFileSync(cargo, 'utf8');
const cargoBefore = cc;
cc = cc.replace(/description = "Yamet —/, 'description = "YaMet —');
if (cc !== cargoBefore) {
  fs.writeFileSync(cargo, cc, 'utf8');
  total += 1;
  console.log('src-tauri/Cargo.toml: 1 处');
}

console.log(`\n共转正 ${total} 处`);

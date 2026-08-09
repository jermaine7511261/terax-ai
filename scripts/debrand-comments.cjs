/**
 * 去除代码注释中的外部品牌引用（品牌独立）。
 * 只删除品牌词本身，保留技术含义（函数名/文件引用/能力描述）。
 * 处理：.ts/.tsx/.rs 文件的注释与描述文本。
 * 品牌词：hermes/Hermes/Hermes'/PraisonAI/LangBot/grok/Grok/opencode/OpenCode/oh-my-pi
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

const files = walk(ROOT).filter((f) =>
  f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.rs')
);

// 组合标记优先（★ H1 Hermes → ★ H1），再删除独立品牌词
const combos = [
  [/★\s*H1\s+Hermes/g, '★ H1'],
  [/★\s*H2\s+Hermes/g, '★ H2'],
  [/★\s*H3\s+Hermes/g, '★ H3'],
  [/★\s*L1\s+LangBot/g, '★ L1'],
  [/★\s*L4\s+LangBot/g, '★ L4'],
  [/LangBot-style/g, 'builtin-style'],
];

// 独立品牌词（前后非字母数字），含撇号形式
const words = [
  /(?<![A-Za-z])Hermes's(?![A-Za-z])/g,
  /(?<![A-Za-z])Hermes(?![A-Za-z])/g,
  /(?<![A-Za-z])hermes(?![A-Za-z])/g,
  /(?<![A-Za-z])PraisonAI(?![A-Za-z])/g,
  /(?<![A-Za-z])LangBot(?![A-Za-z])/g,
  /(?<![A-Za-z])oh-my-pi(?![A-Za-z])/g,
  /(?<![A-Za-z])Grok(?![A-Za-z])/g,
  /(?<![A-Za-z])grok(?![A-Za-z])/g,
  /(?<![A-Za-z])OpenCode(?![A-Za-z])/g,
  /(?<![A-Za-z])opencode(?![A-Za-z])/g,
];

let total = 0;
for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  const before = c;
  for (const [re, rep] of combos) c = c.replace(re, rep);
  for (const re of words) c = c.replace(re, '');
  if (c !== before) {
    fs.writeFileSync(f, c, 'utf8');
    // 统计删了多少品牌词
    let n = 0;
    for (const [re] of combos) n += (before.match(re) || []).length;
    for (const re of words) n += (before.match(re) || []).length;
    total += n;
    console.log(`${path.relative(ROOT, f)}: ${n} 处`);
  }
}

console.log(`\n共去除品牌引用 ${total} 处`);

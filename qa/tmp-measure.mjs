/** 一次性：量代码库构成 —— 残留体量、未被引用的源文件、空行/注释占比。只读，不改任何东西。 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { sep } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist_verify', '.tmp-import-corpus', '_realpid-sample']);
const toPosix = (p) => p.split(sep).join('/');
const MB = (b) => (b / 1048576).toFixed(1) + ' MB';

function size(p) {
  const st = statSync(p);
  if (st.isFile()) return st.size;
  let n = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) if (!SKIP.has(e.name)) n += size(join(p, e.name));
  return n;
}

console.log('=== 顶层目录体量（真实字节，比行数靠谱）===');
const dirs = readdirSync('.', { withFileTypes: true })
  .filter((e) => e.isDirectory() && !SKIP.has(e.name))
  .map((e) => [e.name, size(e.name)]).sort((a, b) => b[1] - a[1]);
for (const [d, b] of dirs.slice(0, 12)) console.log(`  ${d.padEnd(24)} ${MB(b).padStart(10)}`);

const junk = ['artifacts', 'releases', 'app', 'board-recognition-poc', 'test-builds', 'v1.1.9', 'v1.1.8',
  'tmp-vcf-quality', '验证图-本轮', 'output', 'nnue', 'reference-apps', '_research', 'experiments', '.diag', 'docs'];
let jb = 0;
for (const d of junk) if (existsSync(d)) jb += size(d);
console.log(`  ↑ 「实验/发布/调试/文档残留」类合计 ≈ ${MB(jb)}`);

for (const f of readdirSync('.')) {
  if (!/\.(hprof|zip|bin|tmp|log)$/i.test(f)) continue;
  try { console.log(`  散落大文件 ${f}  ${MB(statSync(f).size)}`); } catch { /* ignore */ }
}

// ── 未被引用的源文件 ──
const srcAll = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); }
    else if (/\.(ts|tsx)$/.test(e.name)) srcAll.push(toPosix(p));
  }
})('src');

const contents = new Map(srcAll.map((f) => [f, readFileSync(f, 'utf8')]));
const allText = [...contents.values()].join('\n');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const unref = [];
for (const f of srcAll) {
  if (/\.test\.tsx?$/.test(f)) continue;
  if (/(^|\/)(main|index|vite-env)\.tsx?$/.test(f)) continue;   // 入口
  const base = basename(f).replace(/\.tsx?$/, '');
  const re = new RegExp('["\x27/]' + escape(base) + '["\x27./]');
  if (!re.test(allText)) unref.push([f, contents.get(f).split('\n').length]);
}
console.log(`\n=== src/ 里没被任何地方 import 的非测试文件：${unref.length} 个 / ${unref.reduce((n, [, l]) => n + l, 0)} 行 ===`);
unref.sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([f, l]) => console.log(`  ${String(l).padStart(5)} 行  ${f}`));

// ── 空行/注释占比（"压缩"类操作的上限）──
const prod = srcAll.filter((f) => !/\.test\./.test(f));
let blank = 0, cmt = 0, tot = 0;
for (const f of prod) for (const L of contents.get(f).split('\n')) {
  tot++; const t = L.trim();
  if (!t) blank++; else if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) cmt++;
}
console.log(`\n=== 非测试源文件 ${tot} 行：空行 ${blank}（${(blank / tot * 100).toFixed(1)}%）+ 注释行 ${cmt}（${(cmt / tot * 100).toFixed(1)}%）`);
const qa = readdirSync('qa').filter((f) => /^tmp-|^_tmp-/.test(f));
console.log(`\nqa/ 下 tmp-*/_tmp-* 一次性脚本：${qa.length} 个`);

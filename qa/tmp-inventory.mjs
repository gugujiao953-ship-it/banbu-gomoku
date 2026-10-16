/**
 * 一次性（只读）：出"仓库残留清理"清单。
 * 关键判据不是大小，而是**是否被 git 跟踪**：
 *   未跟踪/被忽略 ⇒ 纯本地残留，删除不改仓库；
 *   已跟踪 ⇒ 属于仓库内容，动它等于提交改动，必须另议。
 * 另外单独标出"今天事故的恢复证据"（不能删）。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git']);
const sh = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return ''; } };
const MB = (b) => (b / 1048576).toFixed(1);
const mbOf = (b) => b / 1048576;
function size(p) {
  let st; try { st = statSync(p); } catch { return 0; }
  if (st.isFile()) return st.size;
  let n = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) if (!SKIP.has(e.name)) n += size(join(p, e.name));
  return n;
}
function counts(p) {
  let files = 0, tracked = 0;
  (function w(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const q = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) w(q); }
      else { files++; }
    }
  })(p);
  const t = sh(['ls-files', '--', p + '/']).trim();
  tracked = t ? t.split('\n').length : 0;
  return { files, tracked };
}

const entries = readdirSync('.', { withFileTypes: true }).filter((e) => !SKIP.has(e.name));
const rows = entries.map((e) => {
  const p = e.name, b = size(p), ign = sh(['check-ignore', '-q', '--', p]).trim() !== '' || e.isDirectory() === false && false;
  const isIgnored = (() => { try { execFileSync('git', ['check-ignore', '-q', '--', p], { stdio: 'ignore' }); return true; } catch { return false; } })();
  const c = e.isDirectory() ? counts(p) : { files: 1, tracked: sh(['ls-files', '--', p]).trim() ? 1 : 0 };
  void ign;
  return { p, isDir: e.isDirectory(), mb: mbOf(b), ...c, isIgnored };
}).filter((r) => r.mb > 0.5 || r.tracked > 0).sort((a, b) => b.mb - a.mb);

console.log('目录/文件'.padEnd(26) + '体量'.padStart(11) + '文件数'.padStart(9) + 'git 跟踪'.padStart(10) + '  忽略');
for (const r of rows.slice(0, 26))
  console.log(`${(r.p + (r.isDir ? '/' : '')).padEnd(26)}${(MB(r.mb) + ' MB').padStart(11)}${String(r.files).padStart(9)}${String(r.tracked).padStart(10)}  ${r.isIgnored ? '是（本地残留）' : '否（在仓库里）'}`);

// ── 恢复证据（不能删）──
console.log('\n=== ⛔ 今天事故的恢复证据（建议保留）===');
for (const p of ['artifacts/quarantine', 'qa/recover']) {
  if (!existsSync(p)) continue;
  console.log(`  ${p}/  ${MB(size(p))} MB`);
  for (const f of readdirSync(p).slice(0, 14)) {
    const q = join(p, f); const st = statSync(q);
    console.log(`     ${st.isDirectory() ? '[dir] ' : ''}${f}  ${st.isDirectory() ? MB(size(q)) : MB(st.size)} MB`);
  }
}
const baks = [];
(function w(d, depth) {
  if (depth > 3 || !existsSync(d)) return;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const q = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') w(q, depth + 1); }
    else if (/\.(bak|orig|broken.*)$/i.test(e.name) || /image-recognition|\.ts$|\.tsx$/.test(e.name)) baks.push([q, statSync(q).size]);
  }
})('artifacts', 0);
const srcBaks = baks.filter(([q]) => /\.(bak|ts|tsx|orig)$/i.test(q));
console.log(`  artifacts/ 下疑似"源码快照"的文件（.bak/.ts/.tsx）: ${srcBaks.length} 个 / ${MB(srcBaks.reduce((n, [, b]) => n + b, 0))} MB`);
srcBaks.sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([q, b]) => console.log(`     ${MB(b)} MB  ${q}`));

// ── qa 脚本分类 ──
const qa = readdirSync('qa');
const tmpQa = qa.filter((f) => /^tmp-|^_tmp-/.test(f));
const gates = qa.filter((f) => /\.mjs$/.test(f) && !/^tmp-|^_tmp-/.test(f));
console.log(`\n=== qa/ ===\n  一次性脚本 tmp-*/_tmp-*: ${tmpQa.length} 个\n  常驻门禁脚本: ${gates.length} 个`);
const referenced = readFileSync('package.json', 'utf8') + (existsSync('qa/REGRESSION.md') ? readFileSync('qa/REGRESSION.md', 'utf8') : '') + (existsSync('README.md') ? readFileSync('README.md', 'utf8') : '');
const orphanGates = gates.filter((f) => !referenced.includes(f));
console.log(`  常驻脚本里"没被 package.json/REGRESSION.md/README 提到"的: ${orphanGates.length} 个`);

/**
 * 一次性：在 quarantine 副本上定位「缺的那个 `}`」。（先自检探测本身可信，再下结论）
 * 原理：缺一个 `}` ⇒ 其后代码多嵌套一层 ⇒ 到 4637 的 `finally` 报错。
 *   在第 L 行之前补一个 `}`，只有当 L 落在缺口之后时语法错才消失 —— 单调 ⇒ 二分。
 * 用 rolldown（node 内可跑；esbuild 在这台机器上 spawn 不了）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rolldown } from 'rolldown';

const SRC = process.argv[2] || 'artifacts/quarantine/image-recognition.ts.broken-20261008';
const lines = readFileSync(SRC, 'utf8').split('\n');
console.log(`${SRC}: ${lines.length} 行`);

/** 插入一个 '}' 到第 at 行之前后，能否被解析（只看 PARSE_ERROR） */
async function parses(withBraceAt, extra = []) {
  const copy = [...lines];
  for (const n of [...extra, withBraceAt].filter(Boolean).sort((a, b) => b - a)) copy.splice(n - 1, 0, '}');
  const tmp = join(tmpdir(), `br-${withBraceAt}-${extra.join('_') || 0}.ts`);
  writeFileSync(tmp, copy.join('\n'));
  try {
    const b = await rolldown({ input: tmp, logLevel: 'silent', onLog: () => {} });
    await b.generate({ format: 'esm' });
    return { ok: true };
  } catch (e) {
    const m = String(e.message || e).replace(/\u001b\[[0-9;]*m/g, '');
    const isParse = /PARSE_ERROR|Unexpected token|Expected/.test(m);
    const at = m.match(/:(\d+):(\d+)\s*\]/);
    return { ok: false, isParse, line: at ? +at[1] : 0, msg: m.split('\n').slice(0, 3).join(' ').slice(0, 200) };
  }
}

// ── 自检：未修补必然 PARSE_ERROR，且报在 finally 附近；补一个 } 在缺口之后应变成"可解析" ──
const raw = await parses(0);
console.log('自检·原样:', raw.ok ? '✗ 竟然能解析（探测不可信）' : `PARSE 错 @${raw.line} ✓（期望在 4637 附近）`);
if (raw.ok) process.exit(1);

const LO = 3400, HI = lines.length;
const hiFixes = await parses(HI);
if (!hiFixes.ok) {
  console.log(`自检·在末尾补一个 } 仍失败（${hiFixes.msg}）⇒ 缺的不止一处，或还夹着重复块`);
} else {
  let lo = LO, hi = HI;
  while (lo < hi) { const m = (lo + hi) >> 1; if ((await parses(m)).ok) hi = m; else lo = m + 1; }
  console.log(`★ 缺的 } 应补在第 ${lo} 行之前`);
  for (let i = Math.max(0, lo - 7); i < Math.min(lines.length, lo + 3); i++)
    console.log(`${String(i + 1).padStart(5)}${i + 1 === lo ? ' >>>' : '    '} ${lines[i].slice(0, 112)}`);
}

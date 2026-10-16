/**
 * 一次性：定位 src/image-recognition.ts 里多出来的那个 `}`。
 * 关键前提：计数器本身必须是可信的 —— 所以先拿几个**已知正确**的 TS 文件跑一遍，
 * 它们结尾深度必须都是 0；只有自检全过，才用同一个计数器去判故障文件。
 * （前两次我写的计数器分别被模板串 ${} 和正则字面量打败，所以这次加了正则识别 + 自检。）
 */
import { readFileSync, readdirSync } from 'node:fs';

function scan(src) {
  const depths = [];
  let i = 0, line = 1, depth = 0;
  const lastMeaningful = () => {                      // 用来判断 / 是正则还是除号
    for (let k = i - 1; k >= 0; k--) {
      const c = src[k];
      if (c === ' ' || c === '\t' || c === '\n') continue;
      return c;
    }
    return '';
  };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') { depths.push([line, depth]); line++; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { depths.push([line, depth]); line++; } i++; } i += 2; continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '\n') break; i++; } i++; continue; }
    if (c === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') { i += 2; let depth0 = 0;      // 进入模板表达式
          while (i < src.length) {
            const d = src[i];
            if (d === '\n') { depths.push([line, depth]); line++; i++; continue; }
            if (d === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
            if (d === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
            if (d === "'" || d === '"') { const q = d; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { i += 2; continue; } i++; } i++; continue; }
            if (d === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { i += 2; continue; } i++; } i++; continue; }
            if (d === '{') { depth++; depth0++; i++; continue; }
            if (d === '}') { if (depth0 === 0) { i++; break; } depth--; depth0--; i++; continue; }   // 匹配到 ${ 的收尾：不再额外自减
            i++;
          }
          continue;
        }
        if (src[i] === '\n') { depths.push([line, depth]); line++; }
        i++;
      }
      continue;
    }
    // 正则字面量：/ 出现在表达式起始位置时按正则跳过（否则 { } 会被错数）
    if (c === '/') {
      const p = lastMeaningful();
      if (p === '' || '(,=:[!&|?{};+-*%~^<>'.includes(p)) {
        i++;
        let inClass = false;
        while (i < src.length) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '[') inClass = true; else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { i++; break; }
          else if (d === '\n') break;
          i++;
        }
        continue;
      }
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    i++;
  }
  depths.push([line, depth]);
  return { depths, endDepth: depth, lines: line };
}

// ① 自检：已知正确的文件，结尾深度必须为 0
const probe = ['src/App.tsx', 'src/game.ts', 'src/features/vcf/vcf-generator.ts', 'src/styles.css'.replace('styles.css', 'storage.ts')];
let ok = true;
for (const f of probe) {
  try { const r = scan(readFileSync(f, 'utf8')); const good = r.endDepth === 0; if (!good) ok = false;
    console.log(`自检 ${f}: 结尾深度 ${r.endDepth} ${good ? '✓' : '✗（计数器不可信）'}`); } catch (e) { console.log(`自检 ${f}: 跳过（${e.message.slice(0, 40)}）`); }
}
if (!ok) { console.log('计数器自检未过，结论不可用，先别据此改文件'); process.exit(1); }

// ② 正式：故障文件
const target = 'src/image-recognition.ts';
const r = scan(readFileSync(target, 'utf8'));
console.log(`\n${target}: ${r.lines} 行，结尾深度 ${r.endDepth}`);
if (r.endDepth === 0) console.log('花括号是平衡的 ⇒ 破损不是花括号（可能是别的：未闭合的模板串/注释等）');
else {
  const bad = r.depths.filter(([l, d]) => l > 3445 && l < 4640 && d < 0);
  console.log('try 体内深度 < 0 的行:', bad.length ? bad.slice(0, 6).map(([l, d]) => `${l}:${d}`).join(' ') : '（无）');
  const lines = readFileSync(target, 'utf8').split('\n');
  const hit = bad.length ? bad[0][0] : null;
  if (hit) for (let i = Math.max(0, hit - 4); i < Math.min(lines.length, hit + 2); i++)
    console.log(`${String(i + 1).padStart(5)}${i + 1 === hit ? ' >>>' : '    '} ${lines[i].slice(0, 120)}`);
}

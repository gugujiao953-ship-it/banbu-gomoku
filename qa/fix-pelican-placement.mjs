/**
 * qa/fix-pelican-placement.mjs — 把「黄昏骑行」那段 CSS 从错误位置挪到正确位置。
 *
 * 事故：插入时用「锚点行号 + 2」定位，而锚点下面那条巴洛克规则有 3 行，
 * 于是整段被塞进了那条规则的声明块里 → 浏览器把它当无效声明丢掉：
 * 表现为 token 生效（:root[...] 规则在别处）、但所有 .ts-far/.ts-near/.ts-parts 覆盖全部失效。
 *
 * 做法：① 找到整段（从注释开头到最后一个 keyframes 的收尾 }）；② 挖出来；
 *       ③ 插到巴洛克那条 .ts-parts i 规则的收尾 } 之后（也就是顶层）。
 */
import { readFileSync, writeFileSync } from "node:fs";

const p = "src/styles.css";
let s = readFileSync(p, "utf8");
const before = s.length;

const startMarker = "/* ── 黄昏骑行：落日天色";
const start = s.indexOf(startMarker);
if (start < 0) throw new Error("找不到黄昏骑行段");

/** 从 `from` 处的 { 开始配对到收尾 }，返回其后的下标。 */
function afterBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") { depth -= 1; if (depth === 0) return i + 1; }
  }
  throw new Error("花括号不配对");
}
const birdKf = s.indexOf("@keyframes pelican-bird{", start);
if (birdKf < 0) throw new Error("找不到 pelican-bird 关键帧");
const end = afterBrace(s, s.indexOf("{", birdKf));
const block = s.slice(start, end).trimEnd() + "\n";
s = s.slice(0, start) + s.slice(end);

// 清理挖走处可能留下的空行
s = s.replace(/\n{3,}/g, "\n\n");

// 插到巴洛克 .ts-parts i 规则之后（顶层）
const anchorRule = 'html[data-theme="baroque"] .ts-parts i{';
const a = s.indexOf(anchorRule);
if (a < 0) throw new Error("找不到巴洛克粒子规则");
const aEnd = afterBrace(s, s.indexOf("{", a));
s = s.slice(0, aEnd) + "\n\n" + block + s.slice(aEnd);

writeFileSync(p, s);
console.log(`已挪位（文件 ${before} → ${s.length} 字节）`);
// 复核：该段必须紧跟在一个完整的规则之后，且自身花括号配对
const depthCheck = (() => { let d = 0; for (const c of s) { if (c === "{") d += 1; if (c === "}") d -= 1; } return d; })();
console.log("全文花括号深度（应为 0）：" + depthCheck);

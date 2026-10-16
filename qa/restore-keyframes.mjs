/**
 * qa/restore-keyframes.mjs — 恢复被误删的 @keyframes。
 *
 * 事故：清理死代码的脚本把正则写成了 `\\\\b`（= 匹配字面反斜杠），于是每个名字的计数都是 0，
 * 72 条关键帧被当成死代码全部删除（含应用原有的 fade-in / toast-in / sheet-up / tour-pulse 等）。
 *
 * 恢复策略（只回填「当前文件里还被引用、但定义已丢」的名字）：
 *   ① 优先用 `git show HEAD:src/styles.css` 的定义（格式完好）；
 *   ② HEAD 里没有的（今天新写的主题关键帧）从 dist 最近一次构建的 CSS 里取，取出来做换行美化；
 *   ③ 只回填被引用的名字——我**故意**停用的旧主题动画（rain-fall / porcelain-drift 等）不再恢复。
 *
 * 用法：node qa/restore-keyframes.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TARGET = "src/styles.css";
const DRY = process.argv.includes("--dry");
let css = readFileSync(TARGET, "utf8");

/** 从一段 CSS 里抽出所有 @keyframes 定义（花括号配对，能处理嵌套的 from/to 块）。 */
function extractKeyframes(text) {
  const out = new Map();
  const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open;
    for (; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    out.set(name, text.slice(m.index, i));
  }
  return out;
}
/** 压缩的一行关键帧 → 可读多行（只做换行与缩进，不改内容）。 */
function pretty(block) {
  return block
    .replace(/\s*\{\s*/g, " {\n  ")
    .replace(/;\s*/g, ";\n  ")
    .replace(/\s*\}\s*(?=[A-Za-z@}])/g, "\n}\n")
    .replace(/\n\s*\n/g, "\n")
    .replace(/ {\n  \}/g, " {}")
    .trim();
}

// ① HEAD 版
const headCss = execFileSync("git", ["show", "HEAD:src/styles.css"], { encoding: "utf8", maxBuffer: 1e8 });
const headDefs = extractKeyframes(headCss);
// ② dist（最近一次构建的全部 CSS）
const distDefs = new Map();
for (const f of readdirSync("dist/assets").filter((x) => x.endsWith(".css"))) {
  for (const [n, d] of extractKeyframes(readFileSync(`dist/assets/${f}`, "utf8"))) distDefs.set(n, d);
}
// 也已写入 android 工程的那份（cap sync 产物，等于上一次构建）
try {
  for (const f of readdirSync("android/app/src/main/assets/public/assets").filter((x) => x.endsWith(".css"))) {
    for (const [n, d] of extractKeyframes(readFileSync(`android/app/src/main/assets/public/assets/${f}`, "utf8"))) if (!distDefs.has(n)) distDefs.set(n, d);
  }
} catch { /* 没有也不影响 */ }

// ③ 当前文件里被引用的名字（animation / animation-name 声明里的标识符）
const referenced = new Set();
for (const m of css.matchAll(/animation(?:-name)?\s*:\s*([^;{}]+)/g)) {
  for (const tok of m[1].matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)) referenced.add(tok[0]);
}
// 已知非关键帧的关键字
const KEYWORDS = new Set(["linear","ease","ease-in","ease-out","ease-in-out","infinite","alternate","alternate-reverse","normal","reverse","forwards","backwards","both","none","running","paused","steps","cubic-bezier","calc","var","s","ms","dvh","px"]);
const have = new Set(extractKeyframes(css).keys());
const missing = [...referenced].filter((n) => !KEYWORDS.has(n) && !have.has(n) && (headDefs.has(n) || distDefs.has(n)));
const stillUnknown = [...referenced].filter((n) => !KEYWORDS.has(n) && !have.has(n) && !headDefs.has(n) && !distDefs.has(n));

console.log(`当前文件已有 ${have.size} 条；被引用但缺失 ${missing.length} 条：`);
console.log("  " + missing.join(", "));
if (stillUnknown.length) console.log(`⚠ 未能找到定义（需要手写）：${stillUnknown.join(", ")}`);

const blocks = missing.map((n) => {
  const raw = headDefs.get(n) ?? distDefs.get(n);
  const formatted = headDefs.has(n) ? raw : pretty(raw);
  const from = headDefs.has(n) ? "HEAD" : "dist";
  return { n, text: `/* 恢复（${from}）：@keyframes ${n} */\n${formatted}` };
});

if (!DRY && blocks.length) {
  // 插到文件末尾的「恢复区」，并在文件里留一句说明
  const marker = "/* ══ 关键帧恢复区（2026-10-07）：清理脚本误删后按引用关系回填 ══ */";
  if (!css.includes(marker)) css = `${css}\n\n${marker}\n`;
  // 若已有恢复区，把新块追加在其后（避免重复插到底部以外的地方）
  css = `${css}\n${blocks.map((b) => b.text).join("\n\n")}\n`;
  writeFileSync(TARGET, css);
  console.log(`已回填 ${blocks.length} 条到 ${TARGET}`);
} else if (DRY) {
  console.log("（--dry：未写入）");
}

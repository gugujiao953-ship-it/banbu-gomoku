import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 静态门禁：CSS 里 `var(--x)` 引用的变量必须在某处被定义过。
 *
 * 为什么单独一条：`var(--panel, #fff)` 只要 `--panel` 从没定义，兜底色就**永远生效**，
 * 深色主题下那块还是白的——默认主题下看是"对的"，肉眼与截图巡查都发现不了。
 * 本项目已经吃过三次：`--border`（真名 `--line`）、`--color-surface-raised`
 * （分析面板选框菜单在 8 套暗色主题下白底白字，对比度 1.04–1.19）、
 * `--panel`（云端引擎 iKataGo 配置框白底 + `color:inherit` 近白文字，2026-10-01 抓到）。
 *
 * 用法：node scripts/check-dead-css-vars.mjs
 */

const root = "src";
const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

const files = walk(root).filter((f) => /\.(css|tsx?|jsx?)$/.test(f));
const texts = new Map(files.map((f) => [f, readFileSync(f, "utf-8")]));

const defined = new Set();
for (const text of texts.values()) {
  for (const match of text.matchAll(/(--[A-Za-z][A-Za-z0-9-]*)\s*:/g)) defined.add(match[1]);
  // TS/TSX 里动态写入：style={{ "--x": … }} 或 setProperty("--x", …)
  for (const match of text.matchAll(/["'`](--[A-Za-z][A-Za-z0-9-]*)["'`]/g)) defined.add(match[1]);
}

const dead = new Map();
let usedCount = 0;
for (const [file, text] of texts) {
  if (!file.endsWith(".css")) continue;
  // 注释里的 var() 不算——那些是在记录历史 bug
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of code.matchAll(/var\((--[A-Za-z][A-Za-z0-9-]*)/g)) {
    const name = match[1];
    usedCount += 1;
    if (!defined.has(name) && !dead.has(name)) dead.set(name, `${file}：${code.slice(Math.max(0, match.index - 60), match.index + 40).trim()}`);
  }
}

// 自检：扫描本身要真的扫到东西，否则「0 个死变量」是假绿
// （上一版把它写成 vitest 用例时，?raw 读 CSS 返回空模块，used=0 就直接通过了）。
if (usedCount < 200 || defined.size < 80) {
  console.error(`[死变量检查] 扫描异常：CSS 里只匹配到 ${usedCount} 个 var() 引用、${defined.size} 个定义——检查逻辑或文件遍历坏了，不能当成通过`);
  process.exit(2);
}

if (dead.size > 0) {
  console.error(`[死变量检查] ${dead.size} 个 CSS 变量被引用却从未定义，var() 的兜底值会在所有主题下生效：`);
  for (const [name, where] of dead) console.error(`  ✗ ${name}  ——  ${where}`);
  process.exit(1);
}
console.log(`[死变量检查] 通过：CSS 引用面 ${new Set().size ? "" : ""}扫到 ${usedCount} 处 var()，定义 ${defined.size} 个变量，无死变量`);

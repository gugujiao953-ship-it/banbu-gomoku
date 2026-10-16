import fs from "node:fs";
import path from "node:path";

/**
 * 静态门禁：**填在主题强调色上的文字不许写死颜色**。
 *
 * 病根（2026-10-02 主题巡查）：`--green` 有双重身份——浅色主题里它是深绿（当文字色、也当填充色都
 * 没问题），但有 9 套深色主题它本身就是浅绿/亮金（cyber #4fe4df、firefly #8fbe88、blackgold #d4b365…），
 * 这类地方一律写 `color:#fff` 的按钮就在那些主题里变成白字压亮底，实测 2.1–3.0:1。
 * 现在统一走 `--on-accent`（浅色主题=白，这 9 套=--paper），本脚本负责钉住别再长回来。
 *
 * 反假绿自检：全仓至少要找到 ≥20 条「填充用 var(--green)」的规则，否则说明扫描本身失效了
 * （比如正则被改坏、CSS 文件搬走），这时直接判失败而不是「零违规」通过。
 *
 * 用法：node scripts/check-hardcoded-ink.mjs
 */
const ROOT = "src";
const EXCLUDE = /legacy-webview|design-tokens\.bak/;
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".css") && !EXCLUDE.test(e.name)) files.push(p);
  }
};
walk(ROOT);

const ACCENT_FILL = /background(?:-color)?\s*:\s*var\(\s*--green\b/i;
// 注意结尾：规则体是正则切出来的，**最后一条声明后面没有分号也没有花括号**，
// 所以 lookahead 必须允许行尾（第一版漏了这个，`.round-add{…;color:white}` 整条漏检，
// 是靠逐主题量的浏览器探针 .tmp-accent-ink-check.mjs 补抓到的）。
const HARDCODED_LIGHT_TEXT = /(?:^|[;\s])color\s*:\s*(#fff\b|#ffffff\b|white|#f8f6f1|#fdfbf5)\s*(?=[;}]|$)/i;

const violations = [];
let accentFills = 0;
for (const f of files) {
  const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    const body = m[2];
    if (!ACCENT_FILL.test(body)) continue;
    // 主题自己的块（:root[data-theme=...] / html[data-theme=...]）里写死是给那一套主题定的，不算违规
    if (/data-theme/.test(sel)) continue;
    accentFills += 1;
    const hit = HARDCODED_LIGHT_TEXT.exec(body);
    if (hit) violations.push(`${f} :: ${sel.slice(0, 70)} :: ${hit[0].trim()}`);
  }
}

console.log(`扫描 ${files.length} 个 CSS · 「填充用 var(--green)」的规则 ${accentFills} 条`);
if (accentFills < 20) {
  console.log(`FAIL 自检：只找到 ${accentFills} 条强调色填充规则（预期 ≥20）——扫描逻辑或 CSS 位置出了问题，这个门禁现在给不出结论`);
  process.exit(1);
}
for (const v of violations) console.log(`  违规：${v}`);
if (violations.length) {
  console.log(`FAIL ${violations.length} 处把文字颜色写死在主题强调色上：请改成 color:var(--on-accent)`);
  process.exit(1);
}
console.log(`PASS 强调色填充上的文字全部走 --on-accent（${accentFills} 条规则逐条查过）`);

import { chromium } from "playwright";
import { readThemeIds } from "./lib/theme-matrix.mjs";

// 落子颜色切换器（黑白）的「选中态是否看得出来」门禁（2026-09-16 用户报「不容易看出来
// 到底是啥模式」）。**判据全部取自渲染后的计算样式，不靠肉眼、也不靠截图采样坐标**：
// 之前人工核对时把采样点打在棋子上，量出「选中格底」在 7 个主题下恒定不变，
// 得出了相反的结论、白改了一版——所以这里只断言元素自己的颜色与派生对比度。
//
// 检查三件事：
//  ① 滑块（选中格的底）必须是**亮面**：与底槽的对比度 ≥2（深色主题下特意做到 ~2.8–3.2，
//     浅色主题下靠描边+投影区分，所以浅色主题只要求滑块 L ≥ 200）；
//  ② 选中文字压在滑块上必须看得见：对比度 ≥4.5（原先用 var(--ink) 当选中字色，
//     深色主题里 --ink 是浅色 → 白字压白滑块，实测只有 1.06:1）；
//  ③ 选中那一侧的棋子被圈住（不依赖明暗的补充信号），未选中那侧不圈。
//  另外核对**全部**主题下结论一致（先前暗色主题把底槽与滑块都硬编码成同族深灰 #26312d/#3a4741）。
// 用法：BANBU_URL=http://127.0.0.1:5297 node scripts/ui-stone-switch-contrast-check.mjs（自动补 ?qa=1）
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = base.includes("?") ? base : `${base}?qa=1`;
// 主题清单从应用读（.app-shell[data-theme-options]）：以前这里写死 7 套，主题涨到 22 套
// 之后这条门禁其实一直在测同一批老主题（用户 09-17 指出）。
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on("pageerror", (event) => errors.push(String(event).slice(0, 160)));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`);
};

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
await page.reload({ waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForSelector('[role="gridcell"]', { timeout: 180000 });
await page.waitForTimeout(1500);

const read = (theme) => page.evaluate(async (value) => {
  document.documentElement.setAttribute("data-theme", value);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const toRgb = (color) => {
    const numbers = (color.match(/[\d.]+/g) || []).map(Number);
    return (color.startsWith("color(") ? numbers.slice(0, 3).map((n) => Math.round(n * 255)) : numbers.slice(0, 3).map(Math.round));
  };
  const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrast = (a, b) => { const hi = Math.max(luma(a), luma(b)); const lo = Math.min(luma(a), luma(b)); return +((hi + 5) / (lo + 5)).toFixed(2); };
  const sw = document.querySelector(".stone-color-switch");
  if (!sw) return null;
  const track = sw.querySelector(":scope > i");
  const buttons = [...sw.querySelectorAll("button")];
  const selected = buttons.find((button) => button.classList.contains("selected"));
  const others = buttons.filter((button) => button !== selected);
  const slot = toRgb(getComputedStyle(sw).backgroundColor);
  const knob = toRgb(getComputedStyle(track).backgroundColor);
  const ringPattern = /rgb\(\d+, \d+, \d+\) 0px 0px 0px 2px/;
  const side = (button) => {
    const stone = button.querySelector(".player-stone");
    return { aria: button.getAttribute("aria-label"), weight: getComputedStyle(button).fontWeight, textVsKnob: contrast(toRgb(getComputedStyle(button).color), knob), ringed: stone ? ringPattern.test(getComputedStyle(stone).boxShadow) : false };
  };
  return {
    knobLuma: Math.round(luma(knob)),
    // 底槽亮度：用来判断这套主题是不是浅色系（浅色系靠描边/投影区分滑块，不查滑块/底槽比）
    slotLuma: Math.round(luma(slot)),
    knobVsSlot: contrast(knob, slot),
    selected: side(selected),
    others: others.filter((button) => button.querySelector(".player-stone")).map(side),
  };
}, theme);

// 主题清单在页面就绪后再读（源头是 src/theme-options.ts，新增主题自动覆盖）。
const THEMES = await readThemeIds(page);

const rows = [];
for (const theme of THEMES) {
  const info = await read(theme);
  if (!info) { check(`${theme}：能找到落子颜色切换器`, false); continue; }
  rows.push({ theme, ...info });
  console.log(`     ${theme.padEnd(9)} 滑块L=${String(info.knobLuma).padStart(3)} 滑块/槽=${info.knobVsSlot}:1 选中字/滑块=${info.selected.textVsKnob}:1 字重=${info.selected.weight} 圈=${info.selected.ringed}/${info.others.map((o) => o.ringed).join(",")}`);
}

check(`全部 ${THEMES.length} 套主题都能读到切换器的渲染色`, rows.length === THEMES.length, `${rows.length}/${THEMES.length}`);
check("滑块在所有主题下都是亮面（L ≥ 200，不再跟主题一起变深）", rows.every((row) => row.knobLuma >= 200), rows.map((r) => `${r.theme}:${r.knobLuma}`).join(" "));
// ⚠ 白名单不能写死 "light"：主题涨到 22 套后还有 eye/mono/bamboo/snow/porcelain/plum/rice/pale
// 等一堆浅色主题，它们同样是「靠描边/投影区分滑块」。改用底槽亮度判定（浅色系 = 底槽亮）。
const darkRows = rows.filter((row) => row.slotLuma < 128);
check(`深色系主题下滑块与底槽对比度 ≥ 2（浅色主题靠描边/投影区分，只查亮面；深色系 ${darkRows.length} 套）`,
  darkRows.every((row) => row.knobVsSlot >= 2),
  darkRows.map((r) => `${r.theme}:${r.knobVsSlot}`).join(" "));
check("选中文字压在滑块上看得见（≥4.5:1；原先深色主题只有 1.06:1）", rows.every((row) => row.selected.textVsKnob >= 4.5), rows.map((r) => `${r.theme}:${r.selected.textVsKnob}`).join(" "));
check("选中那一侧的棋子被圈住（不依赖明暗的补充信号）", rows.every((row) => row.selected.ringed), rows.map((r) => `${r.theme}:${r.selected.ringed}`).join(" "));
check("未选中那一侧的棋子不圈（否则两个都圈等于没圈）", rows.every((row) => row.others.every((other) => !other.ringed)), rows.map((r) => `${r.theme}:${r.others.map((o) => o.ringed).join(",")}`).join(" "));
check("选中侧字重比未选中侧更重", rows.every((row) => Number(row.selected.weight) >= 700 && row.others.every((other) => Number(other.weight) < Number(row.selected.weight))), rows.map((r) => `${r.theme}:${r.selected.weight}`).join(" "));
check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;

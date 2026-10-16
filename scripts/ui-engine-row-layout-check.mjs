import { chromium } from "playwright";
import { readThemeIds, runThemeMatrix, sampleContrastScript } from "./lib/theme-matrix.mjs";

// 分析面板「引擎设置行」门禁（2026-09-16 用户报「滑杆超出屏幕外」）：
//   ① 内存滑杆与整行都不得超出视口，也不得靠横向滚动藏内容——原先写的是
//      `overflow-x: auto` + `> * { flex: 0 0 auto }`，配一个固定 `width: 72px` 的滑杆，
//      窄屏上内存那一格被整个推出可视区，用户看到的是一截被切掉的滑块；
//   ② 内存格必须是可伸缩的（滑杆吃掉剩余宽度），而不是固定宽度——用户原话
//      「这个应该要随着这些空间的宽裕，而变长变短的，不然固定的话就会很容易出现现在这种情况」；
//   ③ 开关「开」态必须跟随主题（原写 `var(--accent,#3b82f6)`，而 `--accent` 全项目从未定义，
//      永远落蓝色兜底），且与同面板其它控件同色系（--green/--jade）；
//   ④ 滑杆的 accent-color 必须是主题色（引擎这两处一度漏配，落到浏览器默认蓝）。
// 同时把「开关文案上下两行」钉住：并排写会为了不换行把格子一路撑宽。
// Usage: BANBU_URL=http://127.0.0.1:5297 node scripts/ui-engine-row-layout-check.mjs（自动补 ?qa=1）
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const targetUrl = new URL(base);
targetUrl.searchParams.set("qa", "1");
const url = targetUrl.href;
const browser = await chromium.launch({ headless: true });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`);
};

// 打开打谱页的分析面板。一体化后不再有「自调档」这个前提——内存格与多线程开关常显，
// 所以这里只负责把面板打开（保留函数名以免大改调用点）。
const openTunedPanel = async (page) => {
  await page.evaluate(() => { document.querySelector("[aria-label=\"分析\"]")?.click(); });
  await page.waitForTimeout(1800);
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i += 1) {
      if (document.querySelector(".ai-analysis-memory")) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
  await page.waitForTimeout(800);
};
const pages = [];
for (const width of [320, 360, 412, 480]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // 只为验布局，绝不触发 38MB 引擎包下载
  await page.route("**/engine-packs/**", (route) => route.abort());
  await page.route("**/*.lz4", (route) => route.abort());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, engineMultiThread: true, engineThreads: 4, analysisMaxMemoryMb: 2048 }));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(2400);
  await openTunedPanel(page);
  const info = await page.evaluate(() => {
    const row = document.querySelector(".ai-analysis-row--engine");
    const memory = document.querySelector(".ai-analysis-memory");
    const slider = memory?.querySelector('input[type="range"]');
    const mt = document.querySelector(".ai-analysis-mt");
    if (!row || !memory || !slider) return null;
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.x), right: Math.round(r.right), width: Math.round(r.width) }; };
    const style = getComputedStyle(slider);
    return {
      viewportWidth: window.innerWidth,
      row: { ...box(row), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, overflowX: getComputedStyle(row).overflowX },
      memory: box(memory), slider: box(slider),
      sliderMaxWidth: style.maxWidth,
      sliderAccent: style.accentColor,
      toggleDirection: mt ? getComputedStyle(mt).flexDirection : null,
      toggleText: (mt?.textContent || "").trim(),
    };
  });
  pages.push({ width, info, page });
}
for (const entry of pages) {
  const { width, info } = entry;
  if (!info) { check(`${width}px 能渲染出引擎设置行（自调档）`, false); continue; }
  check(`${width}px 内存滑杆完整在视口内`, info.slider.right <= info.viewportWidth && info.slider.left >= 0, `滑杆 ${info.slider.left}–${info.slider.right} vs 视口 ${info.viewportWidth}`);
  check(`${width}px 引擎行不靠横向滚动藏内容`, info.row.scrollWidth <= info.row.clientWidth + 1 && info.row.overflowX !== "auto", `scrollW=${info.row.scrollWidth} clientW=${info.row.clientWidth} overflowX=${info.row.overflowX}`);
  check(`${width}px 内存滑杆宽度随空间变化（不是固定宽）`, info.slider.width >= 60, `宽=${info.slider.width}`);
  check(`${width}px 滑杆用主题色而非默认蓝`, !/rgb\(0,\s*117,\s*255\)|rgb\(0,\s*122,\s*255\)/.test(info.sliderAccent) && info.sliderAccent !== "auto", `accent-color=${info.sliderAccent}`);
  check(`${width}px 开关文案上下两行`, info.toggleDirection === "column" && /多线程/.test(info.toggleText) && /[开关]/.test(info.toggleText), `flex-direction=${info.toggleDirection} 文案=「${info.toggleText}」`);
}
const memoryWidths = pages.map((entry) => entry.info?.slider.width).filter(Boolean);
check("内存滑杆宽度确实随屏宽增长（自适应而非定宽）", new Set(memoryWidths).size >= 3, `各宽度滑杆宽=${memoryWidths.join(" / ")}`);
for (const entry of pages) await entry.page.close();

// 开关「开」态跟随主题
const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
await page.route("**/engine-packs/**", (route) => route.abort());
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(1000);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, engineMultiThread: true, engineThreads: 4 })); });
await page.reload({ waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(2400);
await openTunedPanel(page);
const themeIds = await readThemeIds(page);
const themeRows = await runThemeMatrix(page, themeIds, async () => {
  const style = await page.evaluate(() => {
    const mt = document.querySelector(".ai-analysis-mt");
    if (!mt) return null;
    const computed = getComputedStyle(mt);
    return { border: computed.borderTopColor, color: computed.color, background: computed.backgroundColor, on: mt.classList.contains("on") };
  });
  const sample = await page.evaluate(sampleContrastScript(".ai-analysis-mt"));
  return style && { ...style, ratio: sample?.ratio };
});
const themeStyles = themeRows.map(({ theme, sample }) => ({ theme, ...sample }));
check("开关「开」态存在且为 on", themeStyles.length === themeIds.length && themeStyles.every((s) => s.on), `${themeStyles.length}/${themeIds.length}`);
check("开关描边随主题变化（不再固定蓝 #3b82f6）", new Set(themeStyles.map((s) => s.border)).size >= 2, [...new Set(themeStyles.map((s) => s.border))].join(" | "));
check("开关不再是纯蓝兜底色", themeStyles.every((s) => !/rgb\(59,\s*130,\s*246\)/.test(s.border)), themeStyles.map((s) => `${s.theme}:${s.border}`).join(" "));
check("开关文字与底色对比 ≥ 3:1（各主题都可读）", themeStyles.every((s) => s.ratio >= 3), themeStyles.map((s) => `${s.theme}:${s.ratio}`).join(" "));
await page.close();

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;

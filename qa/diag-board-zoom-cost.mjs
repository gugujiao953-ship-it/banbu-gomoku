// 隔离测量：等应用安静后，打一串连续 Ctrl+滚轮（40 个事件 / 16ms），只看这段窗口的帧。
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const theme = process.env.ZOOM_THEME || "blackgold";
const stoneTheme = process.env.STONE_THEME || "";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block" });
await context.addInitScript(({ theme, stoneTheme }) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ pinchZoom: true }));
  localStorage.setItem("banbu-theme-preference-v1", theme);
  if (stoneTheme) localStorage.setItem("banbu-stone-theme-v1", stoneTheme);
}, { theme, stoneTheme });
const page = await context.newPage();
const url = new URL(base); url.searchParams.set("qa", "1");
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#board", { timeout: 60_000 });
await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
await page.waitForTimeout(2500); // 让后台的引擎包/wasm 准备先安静下来
const result = await page.evaluate(async () => {
  const frames = [];
  const loaf = [];
  let last = performance.now();
  const tick = (now) => { frames.push(Math.round(now - last)); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) loaf.push({ dur: Math.round(e.duration), script: Math.round((e.renderStart || e.startTime) - e.startTime) }); }).observe({ type: "long-animation-frame", buffered: false });
  } catch { /* 忽略 */ }
  const scroller = document.querySelector(".board-scroller");
  const box = scroller.getBoundingClientRect();
  const started = performance.now();
  const mark = frames.length;
  for (let k = 0; k < 40; k += 1) {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
    await new Promise((r) => setTimeout(r, 16));
  }
  const burstMs = Math.round(performance.now() - started);
  await new Promise((r) => setTimeout(r, 500)); // 让提交渲染发生
  const during = frames.slice(mark);
  const sorted = during.slice().sort((a, b) => a - b);
  const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? -1;
  const scale = document.querySelector(".board-zoom-reset")?.textContent?.trim() || "(未放大)";
  return { burstMs, frames: during.length, p50: pct(0.5), p95: pct(0.95), max: sorted[sorted.length - 1] ?? -1, over50: during.filter((f) => f > 50).length, scale, loaf: loaf.slice(0, 5) };
});
console.log(`主题=${theme}${stoneTheme ? `/棋子=${stoneTheme}` : ""} 手势 ${result.burstMs}ms（40 个滚轮事件）→ 放大到 ${result.scale}`);
console.log(`这段窗口的帧：${result.frames} 帧，p50=${result.p50}ms p95=${result.p95}ms 最大=${result.max}ms，>50ms 的 ${result.over50} 个`);
for (const f of result.loaf) console.log(`  长帧 ${f.dur}ms（脚本 ${f.script}ms）`);
await browser.close();

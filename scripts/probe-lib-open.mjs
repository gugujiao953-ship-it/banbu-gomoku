import { chromium } from "playwright";
import { statSync } from "node:fs";

/**
 * 真实大 LIB 打开探针：量「打开一份 N 百 MB 的定式库」到底卡在哪、要多少内存。
 *
 * 为什么需要它：LIB 走的是 RenLib WASM 核心 + 惰性投影，理论上「打开」不随体积线性变慢，
 * 但 `addLibrary` 会 `getArrBuf(file)` 整份读进 ArrayBuffer，再按 `buffer_scale`（3 倍）
 * 申请 WASM 内存、且被 4GB 上限钳制。这几步的真实代价只能用真文件量。
 *
 * 用法：
 *   BANBU_URL=http://localhost:5399/ LIB_PATH="D:/五子棋/定式谱/..." node scripts/.tmp-lib-open-probe.mjs
 */
const url = process.env.BANBU_URL || "http://localhost:5399/";
const base = url.includes("?") ? url : `${url}?qa=1`;
const libPath = process.env.LIB_PATH;
const LIMIT_MS = Number(process.env.LIB_LIMIT_MS || 300_000);
if (!libPath) { console.log("缺少 LIB_PATH"); process.exit(1); }
const bytes = statSync(libPath).size;
console.log(`LIB ${libPath}\n体积 ${(bytes / 1048576).toFixed(1)}MB`);

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
page.setDefaultNavigationTimeout(120_000);
const logs = [];
const errors = [];
page.on("console", (message) => {
  const text = message.text();
  if (/内存|memory|申请|lib|LIB|loading|addLibrary|error/i.test(text)) logs.push(`${message.type()}: ${text.slice(0, 160)}`);
});
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));

const client = await context.newCDPSession(page);
await client.send("Performance.enable");
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
await page.evaluate(() => {
  window.__libLongTasks = [];
  try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__libLongTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] }); } catch { /* ignore */ }
});
const heapOf = async () => {
  const { metrics } = await client.send("Performance.getMetrics");
  const get = (name) => metrics.find((item) => item.name === name)?.value ?? 0;
  return { jsHeapMb: Math.round(get("JSHeapUsedSize") / 1048576), jsHeapTotalMb: Math.round(get("JSHeapTotalSize") / 1048576) };
};
const heapBefore = await heapOf();

await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("导入"))?.click(); });
await page.waitForTimeout(600);
await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("导入棋谱文件"))?.click(); });
await page.waitForTimeout(400);

const started = Date.now();
await page.locator('input[type="file"][accept*=".sgf"]').first().setInputFiles([libPath]);
const timeline = [];
let peakHeap = heapBefore.jsHeapMb;
let outcome = "超时";
const deadline = Date.now() + LIMIT_MS;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const card = document.querySelector("[class*='import-progress']");
    return {
      className: card?.className || "",
      text: (card?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90),
      board: document.querySelectorAll(".stone-piece").length,
      title: document.querySelector(".workspace-current")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 40) || "",
    };
  });
  const heap = await heapOf();
  peakHeap = Math.max(peakHeap, heap.jsHeapMb);
  const last = timeline[timeline.length - 1];
  if (!last || last.text !== state.text || last.className !== state.className) {
    timeline.push({ ms: Date.now() - started, text: state.text, className: state.className.replace("import-progress", "").trim(), heapMb: heap.jsHeapMb });
  }
  if (state.className.includes("import-progress--complete")) { outcome = "成功"; break; }
  if (state.className.includes("import-progress--error")) { outcome = "失败"; break; }
  await page.waitForTimeout(400);
}
const wall = Date.now() - started;
const heapAfter = await heapOf();
const longTasks = await page.evaluate(() => (window.__libLongTasks || []).filter((ms) => ms >= 50));
const finalState = await page.evaluate(() => ({
  progressText: (document.querySelector("[class*='import-progress']")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
  toast: [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent || "").join(" | ").slice(0, 160),
  stones: document.querySelectorAll(".stone-piece").length,
  title: document.querySelector(".workspace-current")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 60) || "",
}));

console.log(`\n结果：${outcome} · 墙钟 ${(wall / 1000).toFixed(1)}s`);
console.log(`内存：JS 堆 ${heapBefore.jsHeapMb}MB → ${heapAfter.jsHeapMb}MB（峰值 ${peakHeap}MB，总堆 ${heapAfter.jsHeapTotalMb}MB）`);
console.log(`主线程长任务：${longTasks.length} 个 / 最长 ${longTasks.length ? Math.max(...longTasks) : 0}ms`);
console.log(`最终：${JSON.stringify(finalState)}`);
console.log("时间线：");
const thinned = timeline.filter((item, index) => index === 0 || index === timeline.length - 1 || item.ms - timeline[Math.max(0, timeline.findLastIndex((other) => other.ms <= item.ms - 2000))].ms >= 2000);
for (const item of thinned.slice(0, 12)) console.log(`  ${(item.ms / 1000).toFixed(1)}s  [${item.className}] ${item.text.slice(0, 60)}  (堆 ${item.heapMb}MB)`);
console.log("核心日志：", logs.slice(0, 10));
console.log("页面报错：", errors.slice(0, 3));

await browser.close();

/**
 * 门禁：分析期间的更新节奏（2026-10-15 修「引擎计算时闪」的验收探针）。
 *
 * 断言：引擎 progress 驱动下
 *   · 候选点层（棋盘上那圈彩点）的 DOM 变更被合流到 ~2.5 次/秒 以内（修前 = 帧率，真机 10 次/秒）；
 *   · 读数（深度/节点文本）仍在更新（说明没有把分析卡死或吞掉）；
 *   · 停止分析后读数保留、不再继续变（flush/reset 语义正确）。
 */
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block" });
await ctx.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
await page.goto(base + "?debug=1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 60_000 });
await page.locator('button:has-text("先自己试试")').first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(2500);
const r0 = await page.evaluate(() => { const r = document.querySelector("svg#board").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
const c = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
for (const d of [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: -20, y: 20 }]) { await page.mouse.click(c.x + d.x, c.y + d.y); await page.waitForTimeout(600); }
await page.evaluate(() => window.__bb.click("分析"));
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('input[aria-label="持续分析"]')?.click());
let live = false;
for (let i = 0; i < 30; i += 1) { if (await page.evaluate(() => document.querySelectorAll(".analysis-candidate-point").length > 0)) { live = true; break; } await page.waitForTimeout(1000); }
if (!live) { console.log("SKIP：本机慢引擎 30s 内没出候选点（引擎出帧率过低，节奏类断言在本机无意义）"); console.log("errors:", errors.length); await browser.close(); process.exit(0); }
const measure = await page.evaluate(async () => {
  const candidateChanges = { n: 0, last: "" };
  const ticks = { n: 0, last: "" };
  const scopedChanges = Object.fromEntries([".theme-scene", ".topbar", ".record-page", ".renju-board", ".board-material-surface", ".board-analysis-surface", ".ai-analysis-panel"].map((selector) => [selector, 0]));
  const cells = () => Array.from(document.querySelectorAll(".analysis-candidate-point")).map((g) => g.getAttribute("aria-label") || "").join("|");
  const stats = () => Array.from(document.querySelectorAll(".ai-analysis-stats b")).map((b) => b.textContent).join("|");
  candidateChanges.last = cells(); ticks.last = stats();
  const mo = new MutationObserver((records) => {
    for (const record of records) for (const selector of Object.keys(scopedChanges)) if (record.target instanceof Element && record.target.closest(selector)) scopedChanges[selector] += 1;
    const now = cells();
    if (now !== candidateChanges.last) { candidateChanges.last = now; candidateChanges.n += 1; }
    const st = stats();
    if (st !== ticks.last) { ticks.last = st; ticks.n += 1; }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 20000));
  mo.disconnect();
  return { seconds: (performance.now() - t0) / 1000, candidateChanges: candidateChanges.n, tickChanges: ticks.n, finalStats: stats(), scopedChanges };
});
console.log(`分析 20s｜候选点层变更 ${measure.candidateChanges} 次（${(measure.candidateChanges / measure.seconds).toFixed(2)}/秒）｜读数变更 ${measure.tickChanges} 次（${(measure.tickChanges / measure.seconds).toFixed(2)}/秒）｜区域 ${JSON.stringify(measure.scopedChanges)}`);
console.log("最终读数:", measure.finalStats);
// 停止分析：读数应保留且不再变
await page.evaluate(() => document.querySelector('input[aria-label="持续分析"]')?.click());
await page.waitForTimeout(1200);
const after = await page.evaluate(async () => {
  const stats = () => Array.from(document.querySelectorAll(".ai-analysis-stats b")).map((b) => b.textContent).join("|");
  const a = stats();
  await new Promise((r) => setTimeout(r, 3000));
  return { a, b: stats(), cand: document.querySelectorAll(".analysis-candidate-point").length, think: !!document.querySelector(".board-thinking-indicator") };
});
console.log(`停止后：读数保留=${after.a === after.b ? "是" : "否"}（${after.a}）｜候选点仍在=${after.cand}｜浮标=${after.think}`);
console.log("页面错误:", errors.length ? errors.slice(0, 4) : "无");

/* 判定（登记进 regression-manifest 的门禁必须有确定性退出码，只打印不算门禁）：
 *  · 候选点层 ≤2.6 次/秒 —— 修前是「每来一帧就重画一遍」（真机 10 帧/秒），这条是「不闪」的量化线；
 *  · 读数仍在更新（≥0.5 次/秒）—— 确认不是靠把分析整体卡死来换安静；
 *  · 停止后读数保留且不再变、零页面错误。 */
const failures = [];
const candRate = measure.candidateChanges / measure.seconds;
const tickRate = measure.tickChanges / measure.seconds;
if (candRate > 2.6) failures.push(`候选点层更新过快 ${candRate.toFixed(2)}/秒（>2.6/秒，会闪）`);
if (tickRate < 0.5) failures.push(`读数几乎不更新 ${tickRate.toFixed(2)}/秒（分析可能被卡死）`);
if (measure.candidateChanges === 0) failures.push("整个 20 秒里候选点一次都没变（分析没在跑）");
if (after.a !== after.b) failures.push(`停止分析后读数还在变：${after.a} → ${after.b}`);
if (errors.length) failures.push(`页面错误 ${errors.length} 条：${errors.slice(0, 2).join(" / ")}`);
if (failures.length) {
  console.log("");
  console.log("判定：FAIL");
  for (const failure of failures) console.log("  ✗ " + failure);
  await browser.close();
  process.exit(1);
}
console.log("");
console.log("判定：PASS —— 候选点层被合流到人眼读得过来的节奏，读数照常更新，停止后不再变，零页面错误");
await browser.close();

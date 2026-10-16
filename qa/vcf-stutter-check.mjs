/**
 * qa/vcf-stutter-check.mjs — 定位「点开始/下一题的卡顿」（用户 10-06）。
 * 真浏览器 + CDP 6× CPU 降速（近似入门安卓机），记录点击后主按钮标签的**变化时间线**
 * （开始挑战 → 匹配中… → 认输（判负）），以及窗口内 longtask 占用，
 * 用来区分「题池/匹配慢」还是「渲染/首帧慢」。
 * 用法：node qa/vcf-stutter-check.mjs [base] [cpuRate]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5198/";
const RATE = Number(process.argv[3] ?? 6);

const clickByText = (page, text) => page.evaluate((t) => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === t);
  if (btn) { btn.click(); return true; }
  return false;
}, text);
const clickNav = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const btn = nav ? Array.from(nav.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === l) : null;
  if (btn) { btn.click(); return true; }
  return false;
}, label);
const primaryLabel = (page) => page.evaluate(() => {
  const b = document.querySelector(".vcfch-bottom .vcfch-primary");
  return b ? (b.textContent || "").trim() : null;
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${String(e.stack ?? e).slice(0, 600)}`));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__lt = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* 旧引擎没有 longtask */ }
});

const t0 = Date.now();
await clickNav(page, "对弈");
await page.waitForTimeout(600);
await clickByText(page, "开始挑战");
await page.waitForSelector(".vcfch-board", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
const entryMs = Date.now() - t0;
const entered = await page.evaluate(() => ({ page: !!document.querySelector(".vcfch-page"), board: !!document.querySelector(".vcfch-board") }));
if (!entered.board) {
  console.log("没进 VCF 页，报错：");
  for (const l of logs.slice(-8)) console.log("   " + l);
  await browser.close();
  process.exit(1);
}

/** 点主按钮，按 10ms 采样标签，返回时间线 + longtask。 */
const tap = async (expect) => {
  await page.evaluate(() => { window.__lt.length = 0; });
  const before = await primaryLabel(page);
  const t = Date.now();
  await page.evaluate(() => {
    const b = document.querySelector(".vcfch-bottom .vcfch-primary");
    if (b) b.click();
  });
  const timeline = [];
  let last = null;
  for (let waited = 0; waited < 15000; waited += 10) {
    await page.waitForTimeout(10);
    const l = await primaryLabel(page);
    if (l !== last) { timeline.push(`${l}@${Date.now() - t}ms`); last = l; }
    if (l === expect) break;
  }
  const lt = await page.evaluate(() => window.__lt.slice());
  return { before, timeline, total: Date.now() - t, blocked: lt.reduce((a, b) => a + b.dur, 0), longtasks: lt };
};

console.log(`进入 VCF 页耗时 ${entryMs}ms（含题池首载，CPU ×${RATE}）`);
for (let round = 1; round <= 3; round += 1) {
  const start = await tap("认输（判负）");
  console.log(`第 ${round} 局 · 开始：${start.before} → ${start.timeline.join(" → ")}｜${start.total}ms，longtask ${start.longtasks.length} 段共 ${start.blocked}ms ${JSON.stringify(start.longtasks.slice(0, 5))}`);
  if (round === 1) {
    /* 对局中「什么都不做」的 2 秒：计时器原来每秒重渲染 10 次，全部落在这里。 */
    await page.evaluate(() => { window.__lt.length = 0; });
    await page.waitForTimeout(2000);
    const lt = await page.evaluate(() => window.__lt.slice());
    console.log(`   └ 对局中静置 2s：longtask ${lt.length} 段共 ${lt.reduce((a, b) => a + b.dur, 0)}ms ${JSON.stringify(lt.slice(0, 8))}`);
  }
  const lose = await tap("下一题");
  console.log(`第 ${round} 局 · 认输：${lose.before} → ${lose.timeline.join(" → ")}｜${lose.total}ms`);
}

// 改设置 → 点确定 → 立刻开始
await page.evaluate(() => document.querySelector(".vcfch-top-actions button").click());
await page.waitForTimeout(500);
const chip = await page.evaluate(() => {
  const row = Array.from(document.querySelectorAll(".vcfch-sheet-row")).find((r) => (r.textContent || "").includes("每局时间"));
  const chips = row ? Array.from(row.querySelectorAll("button")) : [];
  const was = chips.find((c) => c.classList.contains("selected"));
  const target = chips.find((c) => (c.textContent || "").includes("180")) ?? chips[chips.length - 1];
  if (target) target.click();
  return { was: was ? was.textContent.trim() : "?", now: target ? target.textContent.trim() : "?" };
});
await page.waitForTimeout(200);
await clickByText(page, "确定");
const afterSetting = await tap("认输（判负）");
console.log(`改设置（限时 ${chip.was} → ${chip.now}）后开始：${afterSetting.before} → ${afterSetting.timeline.join(" → ")}｜${afterSetting.total}ms，longtask ${afterSetting.longtasks.length} 段共 ${afterSetting.blocked}ms`);

// 进摆棋 / 看解答 的响应（用户也提到这两处）
const quitSetup = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((x) => (x.textContent || "").includes("摆棋"));
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(300);
console.log(`进摆棋：${quitSetup ? "成功" : "没找到按钮"}`);

if (logs.length) { console.log("【console 线索】"); for (const l of logs.slice(-8)) console.log("   " + l); }
await browser.close();

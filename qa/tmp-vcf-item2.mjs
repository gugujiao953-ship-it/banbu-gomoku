/** tmp item2: 出题与匹配（各等级分连出 6 题，记录手数·题分·生成器） */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const SHOTS = "qa/tmp-vcf-shots"; mkdirSync(SHOTS, { recursive: true });
const errs = [];
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

const txt = (s) => page.evaluate((x) => document.querySelector(x)?.textContent?.replace(/\s+/g, " ").trim() ?? null, s);
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const waitPrimary = async (want, ms = 90000) => { const t0 = Date.now(); for (;;) { const p = await primary(); if (p === want) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(200); } };
const clickSheet = (t) => page.evaluate((x) => { const bar = document.querySelector(".vcfch-sheet-actions"); const btn = bar ? Array.from(bar.querySelectorAll("button")).find((y) => (y.textContent || "").trim() === x) : null; btn?.click(); }, t);
const gear = () => page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click());

async function enterVcf() {
  await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
  await page.waitForTimeout(500);
  if (await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').count()) {
    await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
  } else {
    // 可能已在 VCF 页（切 tab 保留），直接继续
  }
  await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
}
async function setAttackerBlack() {
  await gear(); await page.waitForTimeout(400);
  await page.evaluate(() => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes("你执子")); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim() === "黑先")?.click(); });
  await clickSheet("确定"); await page.waitForTimeout(400);
}
async function resetViaUI(label) {
  await gear(); await page.waitForTimeout(400);
  await page.locator("[data-vcf-reset]").click(); await page.waitForTimeout(250);
  await page.evaluate((lbl) => { const chips = Array.from(document.querySelectorAll(".vcfch-sheet-reset .vcfch-picker-row button")); chips.find((x) => x.textContent.includes(lbl))?.click(); }, label);
  await page.waitForTimeout(150);
  await page.evaluate(() => { const p = document.querySelector(".vcfch-sheet-reset"); Array.from(p.querySelectorAll("button")).find((b) => b.textContent.includes("确认重置"))?.click(); });
  await page.waitForTimeout(400);
  await clickSheet("取消"); await page.waitForTimeout(250);
}
async function setRatingRaw(r) {
  await page.evaluate((rr) => {
    const s = { rating: rr, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [], settings: { pace: "default", genDeep: true } };
    localStorage.setItem("vcfch-state-v1", JSON.stringify(s));
  }, r);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await enterVcf();
  await setAttackerBlack();
}
const seenTail = () => page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}"); return (s.seenIds || []).slice(-1)[0] ?? null; } catch { return null; } });
const classify = (id) => !id ? "?" : id.startsWith("g-") ? "生成" : "静态";

async function drawOne() {
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
  const ok = await waitPrimary("认输（判负）", 90000);
  const meta = await txt(".vcfch-meta");
  const msg = await txt(".vcfch-message");
  const clock = await page.evaluate(() => document.querySelector(".vcfch-clock b")?.textContent?.trim());
  const id = await seenTail();
  const depth = Number((meta || "").match(/^(\d+) 手/)?.[1] ?? NaN);
  const pr = Number((meta || "").match(/≈(\d+) 分/)?.[1] ?? NaN);
  const gen = (msg || "").includes("生成器出题");
  return { ok, meta, msg, clock, id, cls: classify(id), depth, pr, gen };
}
async function settleAndNext() {
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); // 认输
  await waitPrimary("下一题", 20000);
}

const report = {};
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await enterVcf();
await setAttackerBlack();
check: {
  for (const [label, rating, uiLabel] of [["1000", 1000, "最低档"], ["2600", 2600, "9 手档"], ["3400", 3400, "13 手档"], ["4800", 4800, "20 手档"]]) {
    if (uiLabel) await resetViaUI(uiLabel);
    const got = await page.evaluate(() => JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}").rating);
    const rows = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await drawOne();
      rows.push(r);
      if (!r.ok) break;
      await settleAndNext();
    }
    report[label] = { ratingAfterReset: got, title: label === "1000" ? "基准" : uiLabel, rows };
    console.log(`\n=== 等级分 ${label}（重置后实测 ${got}） ===`);
    for (const r of rows) console.log(`  ${r.depth}手·${r.pr}分 · ${r.cls} · gen=${r.gen} · ${r.msg} · clock=${r.clock} · id=${r.id}`);
  }
}
// 9100（无 UI 档位）：直接写 localStorage 后重载
await setRatingRaw(9100);
{
  const rows = [];
  for (let i = 0; i < 6; i += 1) { const r = await drawOne(); rows.push(r); if (!r.ok) break; await settleAndNext(); }
  report["9100"] = { rows };
  console.log(`\n=== 等级分 9100 ===`);
  for (const r of rows) console.log(`  ${r.depth}手·${r.pr}分 · ${r.cls} · gen=${r.gen} · ${r.msg} · clock=${r.clock} · id=${r.id}`);
}
await page.screenshot({ path: `${SHOTS}/item2-last.png` });
console.log("\nJSON:", JSON.stringify(report));
if (errs.length) console.log("页面报错:", errs.slice(0, 10));
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

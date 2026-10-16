/**
 * qa/vcf-lowband-check.mjs — 最低档能不能出到 1–2 手题（真浏览器）。
 * 用户 2026-10-06：「再搞点1-2手胜的题目吧」→ 新题库 vcf-material-12.json 必须真的被抽到。
 * 流程：全新存档进挑战页 → 连打 6 局（每局认输 → 下一题），把状态行的「N 手」收集起来。
 * 用法：node qa/vcf-lowband-check.mjs [base]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5198/";
const clickByText = (page, text) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === t);
  if (b) { b.click(); return true; }
  return false;
}, text);
const clickNav = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav ? Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === l) : null;
  if (b) b.click();
}, label);
const meta = (page) => page.evaluate(() => document.querySelector(".vcfch-meta")?.textContent?.trim() ?? null);
const primary = (page) => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent.trim() ?? null);
const tapPrimary = (page) => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) { await clickByText(page, "先自己试试"); await page.waitForTimeout(400); }
await clickNav(page, "对弈");
await page.waitForTimeout(500);
await clickByText(page, "开始挑战");
await page.waitForSelector(".vcfch-board", { timeout: 20000 });
await page.waitForTimeout(1500);

const depths = [];
for (let i = 0; i < 8; i += 1) {
  await tapPrimary(page);                                  // 开始挑战 / 下一题
  await page.waitForTimeout(1400);
  const m = await meta(page);
  if (m) depths.push(Number((m.match(/^(\d+) 手/) ?? [])[1] ?? -1));
  if ((await primary(page)) === "认输（判负）") { await tapPrimary(page); await page.waitForTimeout(700); }  // 认输 → 下一题
}
console.log("抽到的手数序列：" + depths.join(", "));
const low = depths.filter((d) => d <= 2).length;
console.log(`1–2 手 ${low} / ${depths.length}`);
if (errors.length) console.log("页面报错：" + errors.slice(0, 4).join(" | "));
await browser.close();
process.exit(low >= 1 && depths.length >= 5 ? 0 : 1);

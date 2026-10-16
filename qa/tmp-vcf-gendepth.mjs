/** tmp: 各等级分下生成器出题耗时 + 是否成功（9100 疑回落静态题） */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const waitPrimary = async (want, ms) => { const t0 = Date.now(); for (;;) { if (await primary() === want) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await page.waitForTimeout(150); } };
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(500);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
// 固定黑先
await page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click());
await page.waitForTimeout(400);
await page.evaluate(() => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes("你执子")); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim() === "黑先")?.click(); });
await page.evaluate(() => { const bar = document.querySelector(".vcfch-sheet-actions"); Array.from(bar.querySelectorAll("button")).find((y) => y.textContent.trim() === "确定")?.click(); });
await page.waitForTimeout(400);

console.log("rating | wantDepth | ms | 结果 | message");
for (const R of [4000, 4800, 5600, 6400, 7200, 8000, 8800, 9100]) {
  await page.evaluate((rr) => {
    const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}");
    s.rating = rr; s.settings = { pace: "default", genDeep: true };
    localStorage.setItem("vcfch-state-v1", JSON.stringify(s));
  }, R);
  // 不重载：React state 不会自己读回；用重置面板无法到 9100，所以改用"直接改后用 title 刷新"? 只能重载。
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
  await page.waitForTimeout(400);
  await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
  await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);
  const want = Math.max(1, Math.round((Math.min(R, 8800) - 1000) / 200 + 1));
  const clicked = Date.now();
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
  const ms = await waitPrimary("认输（判负）", 90000);
  const meta = await page.evaluate(() => document.querySelector(".vcfch-meta")?.textContent?.replace(/\s+/g, " ").trim());
  const msg = await page.evaluate(() => document.querySelector(".vcfch-message")?.textContent?.replace(/\s+/g, " ").trim());
  console.log(`R=${R} | wantDepth=${want} | ${ms < 0 ? "TIMEOUT" : ms + "ms"} | ${meta} | ${msg}`);
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); // 认输 settle
  await waitPrimary("下一题", 15000);
}
if (errs.length) console.log("页面报错:", errs.slice(0, 12));
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

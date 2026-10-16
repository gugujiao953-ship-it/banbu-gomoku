/** tmp: 高等级分出题耗时/是否回落静态题（每次全新 context，避免并发编辑触发 HMR 导航） */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const browser = await chromium.launch({ headless: true });
async function one(R) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.evaluate((rr) => {
      localStorage.setItem("vcfch-state-v1", JSON.stringify({ rating: rr, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [], settings: { pace: "default", genDeep: true } }));
    }, R);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
    await page.waitForTimeout(500);
    await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
    await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    const t0 = Date.now();
    await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
    let ms = -1;
    for (let i = 0; i < 400; i += 1) {
      const p = await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim());
      if (p === "认输（判负）") { ms = Date.now() - t0; break; }
      if (p === "开始挑战" && i > 8) { ms = -2; break; } // 匹配失败
      await page.waitForTimeout(200);
    }
    const meta = await page.evaluate(() => document.querySelector(".vcfch-meta")?.textContent?.replace(/\s+/g, " ").trim());
    const msg = await page.evaluate(() => document.querySelector(".vcfch-message")?.textContent?.replace(/\s+/g, " ").trim());
    // 认输结算后取权威 id/depth
    await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
    await page.waitForTimeout(700);
    const h0 = await page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem("vcfch-state-v1")); return s.history?.[0] ?? null; } catch { return null; } });
    const want = Math.max(1, Math.round((Math.min(R, 8800) - 1000) / 200 + 1));
    return { R, want, ms, meta, msg, id: h0?.id, depth: h0?.depth, errs };
  } catch (e) {
    return { R, error: String(e.message).slice(0, 200), errs };
  } finally {
    await ctx.close();
  }
}
const out = [];
for (const R of [4800, 5200, 6400, 8000, 9100]) out.push(await one(R));
for (const o of out) console.log(JSON.stringify(o));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 4000))]);

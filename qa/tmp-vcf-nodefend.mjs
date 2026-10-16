/** tmp: 找「无法防守的冲四」样本（白方攻方 / 守方黑、挡点是黑禁手） */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const VIEW = 572, MARGIN = 46, CELL = (572 - 92) / 14;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim());
const waitPrimary = async (w, ms = 90000) => { const t0 = Date.now(); for (;;) { if (await primary() === w) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(150); } };
const scan = () => page.evaluate(async () => {
  const eng = await import("/src/features/vcf-challenge/engine.ts");
  const board = new Int8Array(225);
  document.querySelectorAll("[data-vcf-stone]").forEach((g) => { board[Number(g.getAttribute("data-vcf-stone"))] = Number(g.getAttribute("data-vcf-player")); });
  const side = document.querySelector(".vcfch-side-chip b")?.textContent?.trim() === "白" ? "white" : "black";
  const out = [];
  for (let i = 0; i < 225; i += 1) { if (board[i]) continue; const v = eng.classifyAttack(board, Math.floor(i / 15), i % 15, side); if (v.message.includes("无法防守")) out.push({ idx: i, side, message: v.message }); }
  return out;
});
async function tap(idx) { const box = await page.evaluate(() => { const r = document.querySelector(".vcfch-board").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }); const row = Math.floor(idx / 15), col = idx % 15; await page.mouse.click(box.left + ((MARGIN + col * CELL) / VIEW) * box.width, box.top + ((MARGIN + row * CELL) / VIEW) * box.height); await page.waitForTimeout(150); }
await page.goto(BASE, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
await page.evaluate(() => { const s = { rating: 1000, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [], settings: { pace: "default", genDeep: true } }; localStorage.setItem("vcfch-state-v1", JSON.stringify(s)); });
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(400);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 }); await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click()); await page.waitForTimeout(300);
await page.evaluate(() => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes("你执子")); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim() === "白先")?.click(); });
await page.evaluate(() => { const bar = document.querySelector(".vcfch-sheet-actions"); Array.from(bar.querySelectorAll("button")).find((y) => y.textContent.trim() === "确定")?.click(); });
await page.waitForTimeout(400);
let found = null, tried = 0;
for (let i = 0; i < 60 && !found; i += 1) {
  if (await primary() === "认输（判负）") { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary").click()); await waitPrimary("下一题", 20000); }
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary").click());
  if (!await waitPrimary("认输（判负）")) break;
  const msg = await page.evaluate(() => document.querySelector(".vcfch-message")?.textContent || "");
  if (!msg.includes("你执白")) { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary").click()); await waitPrimary("下一题", 20000); continue; }
  const depth = Number((await page.evaluate(() => document.querySelector(".vcfch-meta")?.textContent || "")).match(/^(\d+) 手/)?.[1] ?? 0);
  tried += 1;
  const hits = await scan();
  if (hits.length) {
    await tap(hits[0].idx);
    const m = await page.evaluate(() => document.querySelector(".vcfch-message")?.textContent || "");
    const oc = await page.evaluate(() => document.querySelector(".vcfch-outcome b")?.textContent || null);
    found = { depth, side: hits[0].side, m, oc, idx: hits[0].idx };
    break;
  }
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary").click()); await waitPrimary("下一题", 20000);
}
console.log(JSON.stringify({ triedWhiteProblems: tried, found }, null, 1));
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

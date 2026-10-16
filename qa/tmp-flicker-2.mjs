import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block" });
await ctx.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  let cur = {};
  try { cur = JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}"); } catch {}
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ ...cur, analysisAuto: true }));
});
const page = await ctx.newPage();
await page.goto(base + "?debug=1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 60_000 });
await page.locator('button:has-text("先自己试试")').first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log("设置回读:", await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}"); return JSON.stringify({ analysisAuto: s.analysisAuto, count: s.analysisCandidateCount, timeMs: s.analysisTimeMs, mt: s.engineMultiThread }); }));
const rect = await page.evaluate(() => { const svg = document.querySelector("svg#board") || document.querySelector("svg.board") || document.querySelector(".board-scroller svg"); if (!svg) return null; const r = svg.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, id: svg.id, cls: svg.getAttribute("class") }; });
console.log("棋盘 rect:", JSON.stringify(rect));
if (rect) {
  const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  for (const d of [{ x: 0, y: 0 }, { x: 18, y: 18 }, { x: -18, y: 18 }]) {
    await page.mouse.click(c.x + d.x, c.y + d.y);
    await page.waitForTimeout(700);
  }
}
console.log("棋子数:", await page.evaluate(() => document.querySelectorAll(".stone-piece").length));
// 等分析
for (let i = 0; i < 30; i += 1) {
  const s = await page.evaluate(() => ({ cand: document.querySelectorAll(".analysis-candidate-point").length, think: !!document.querySelector(".board-thinking-indicator"), depth: (document.querySelector(".ai-analysis-stats .stat-depth b") || {}).textContent || "-", toast: Array.from(document.querySelectorAll('.toast, [class*="toast"]')).map((e) => e.textContent.trim().slice(0, 40)) }));
  if (s.cand > 0 || s.depth !== "-" || s.think) { console.log("分析启动 @", i * 1.5, "s:", JSON.stringify(s)); break; }
  if (i % 4 === 0) console.log(`  t=${(i * 1.5).toFixed(1)}s`, JSON.stringify(s));
  await page.waitForTimeout(1500);
}
await browser.close();

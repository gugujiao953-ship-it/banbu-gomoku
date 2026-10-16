// 不带 ?qa=1（手动关欢迎卡）开分析，看引擎是否真出数
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block" });
const page = await context.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() !== "log") logs.push(`[${m.type()}] ${m.text().slice(0, 140)}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 180)}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url().slice(-70)} ${r.failure()?.errorText || ""}`));
page.on("response", (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url().slice(-70)}`); });
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 60_000 });
// 关欢迎卡（用户 09-26 的文案：「先自己试试」）
await page.locator('button:has-text("先自己试试")').first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1200);
// 用真实鼠标在棋盘上落几子（空盘可能不开分析）
const box = await page.locator("#board").boundingBox();
if (box) {
  for (const [rx, ry] of [[0.45, 0.45], [0.5, 0.5], [0.55, 0.45]]) {
    await page.mouse.click(box.x + box.width * rx, box.y + box.height * ry);
    await page.waitForTimeout(400);
  }
}
const placed = await page.evaluate(() => document.querySelectorAll(".stone-piece").length);
console.log("落子后棋子数：", placed);
await page.locator('button[aria-label="分析"]').first().click().catch(() => {});
await page.waitForTimeout(600);
await page.locator('input[aria-label="开启分析"]').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(15000);
const out = await page.evaluate(() => ({
  panel: (document.querySelector(".ai-analysis-panel")?.textContent || "").replace(/\s+/g, " ").slice(0, 200),
  stones: document.querySelectorAll(".stone-piece").length,
}));
console.log("面板：", out.panel);
console.log("console（前 10 条非 log）：");
for (const line of logs.slice(0, 10)) console.log("  ", line);
await browser.close();

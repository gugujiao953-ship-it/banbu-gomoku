import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block" });
await ctx.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
const page = await ctx.newPage();
await page.goto((process.env.QA_BASE_URL || "http://localhost:4173/") + "?debug=1", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".app-shell", { timeout: 60_000 });
await page.locator('button:has-text("先自己试试")').first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(2500);
const r = await page.evaluate(() => { const b = document.querySelector("svg#board").getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; });
await page.mouse.click(r.x, r.y); await page.waitForTimeout(600);
await page.evaluate(() => window.__bb.click("分析"));
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('input[aria-label="持续分析"]')?.click());
for (let i = 0; i < 20; i += 1) { if (await page.evaluate(() => !!document.querySelector(".board-thinking-indicator"))) break; await page.waitForTimeout(1000); }
console.log("分析中浮标:", await page.evaluate(() => !!document.querySelector(".board-thinking-indicator")));
await page.evaluate(() => document.querySelector('input[aria-label="持续分析"]')?.click());
const seq = [];
for (let i = 0; i < 14; i += 1) { seq.push(await page.evaluate(() => (document.querySelector(".board-thinking-indicator") ? "1" : "0"))); await page.waitForTimeout(1000); }
console.log("停止后每秒是否显示浮标:", seq.join(" "));
await browser.close();

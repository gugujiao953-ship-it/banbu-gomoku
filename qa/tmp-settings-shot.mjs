import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const url = new URL(base); url.searchParams.set("qa", "1");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await context.newPage();
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
await page.locator("nav.bottom-nav button").filter({ hasText: "设置" }).first().click();
await page.waitForSelector(".settings-search input", { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: "qa/tmp-settings-1.png" });
// 搜「复原手序」定位 AI 识图卡（我改过的那块）
await page.locator(".settings-search input").fill("复原手序");
await page.waitForTimeout(500);
await page.screenshot({ path: "qa/tmp-settings-2.png" });
await page.locator(".settings-search input").fill("");
await page.waitForTimeout(400);
// 再往下滚两屏看有没有别的重叠
await page.mouse.wheel(0, 1600); await page.waitForTimeout(500);
await page.screenshot({ path: "qa/tmp-settings-3.png" });
await page.mouse.wheel(0, 1600); await page.waitForTimeout(500);
await page.screenshot({ path: "qa/tmp-settings-4.png" });
console.log("shots saved");
await browser.close();

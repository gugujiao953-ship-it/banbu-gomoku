// 查「无头环境里引擎为什么不出数」：开分析，抓 console 与面板状态
import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: true }));
});
const page = await context.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 160)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 200)}`));
await page.goto(new URL("?qa=1", base.endsWith("/") ? base : base + "/").toString(), { waitUntil: "domcontentloaded" });
await page.waitForSelector("#board", { timeout: 60_000 });
await page.waitForTimeout(2000);
await page.locator('button[aria-label="分析"]').first().click().catch(() => {});
await page.waitForTimeout(600);
await page.locator('input[aria-label="开启分析"]').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(12000);
const state = await page.evaluate(() => {
  const panel = document.querySelector(".ai-analysis-panel") || document.querySelector(".dock-panel-analysis");
  const status = document.querySelector(".ai-analysis-status")?.textContent || "";
  return { panel: (panel?.textContent || "").replace(/\s+/g, " ").slice(0, 160), status: status.slice(0, 80), stones: document.querySelectorAll(".stone-piece").length };
});
console.log("面板：", state.panel);
console.log("状态：", state.status, "｜棋子", state.stones);
console.log("console（前 14 条）：");
for (const line of logs.slice(0, 14)) console.log("  ", line);
await browser.close();

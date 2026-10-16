import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.APP_URL || "http://127.0.0.1:5195";
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = path.join(ROOT, "current-stills");
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "zh-CN", colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block" });
await context.addInitScript(() => { localStorage.setItem("banbu-first-run-welcome-v1", "true"); localStorage.setItem("banbu-onboarding-tour-v1", "seen"); });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.setDefaultNavigationTimeout(30_000);
const failures = [];
page.on("pageerror", (error) => console.log("pageerror", String(error).slice(0, 220)));
page.on("console", (message) => { if (message.type() === "error") console.log("console-error", message.text().slice(0, 220)); });
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name), fullPage: false, timeout: 30_000 }); console.log("shot", name); };
const boot = async () => {
  await page.goto(`${BASE}/?qa=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("新建棋谱", { exact: true }).waitFor({ timeout: 30_000 });
  await wait(750);
  for (let i = 0; i < 4; i += 1) {
    const close = page.locator('[role="dialog"] button[aria-label="关闭"]:visible').last();
    if (!(await close.count())) break;
    await close.click({ force: true }).catch(() => {});
    await wait(180);
  }
};
const nav = async (name) => { await page.getByRole("button", { name, exact: true }).last().click({ force: true }); await wait(550); };
const addMoves = async () => { for (const coord of ["H8", "I9", "G7", "J10", "F6", "K11", "E5", "L12"]) { const cell = page.locator(`[role="gridcell"][aria-label^="${coord}"]`).first(); if (await cell.count()) { await cell.dispatchEvent("click"); await wait(180); } } };
const step = async (name, fn) => { try { console.log("step", name); await fn(); } catch (error) { const message = String(error?.message || error).split("\n")[0]; failures.push(`${name}: ${message}`); console.log("FAIL", name, message); } };

await step("analysis-tabs", async () => {
  await boot(); await nav("打谱"); await addMoves();
  const analyze = page.locator('button[aria-label="分析"]').first(); await analyze.waitFor(); await analyze.click({ force: true });
  await page.locator(".ai-analysis-panel").waitFor({ timeout: 30_000 });
  const running = page.locator('.ai-analysis-panel input[aria-label="持续分析"]');
  if (await running.isVisible().catch(() => false)) { await running.check({ force: true }); await wait(5200); }
  await shot("17-analysis-compute.png");
  for (const [tab, name] of [["review", "18-analysis-review.png"], ["winrate", "19-analysis-winrate.png"]]) {
    const button = page.locator(`[data-panel-tab="${tab}"]`).first();
    if (await button.isVisible().catch(() => false)) {
      if (tab === "review" && await running.isChecked().catch(() => false)) { await running.uncheck({ force: true }); await wait(500); }
      await button.click({ force: true });
      if (tab === "review") {
        const review = page.getByRole("button", { name: "开始复盘", exact: true }).first();
        if (await review.isVisible().catch(() => false)) { await review.click({ force: true }); await wait(3200); }
      } else await wait(850);
      await shot(name);
    }
  }
});

await step("clock-running", async () => {
  await boot(); await nav("对弈");
  const open = page.locator('button[aria-label="打开比赛计时器"]').first();
  console.log("clock button count", await open.count());
  if (!(await open.count())) throw new Error("找不到打开比赛计时器");
  await open.click({ force: true }); await page.locator("[data-clock-panel]").waitFor(); await wait(350); await shot("20-clock-panel.png");
  const settings = page.locator('[data-clock-action="settings"]').first();
  if (await settings.isVisible().catch(() => false)) { await settings.click({ force: true }); await page.locator("[data-clock-setup]").waitFor(); await wait(350); await shot("21-clock-settings.png"); }
});

await step("library-puzzles", async () => {
  await boot(); await nav("棋谱库"); await wait(600); await shot("22-library-records.png");
  const puzzles = page.getByRole("button", { name: "题库", exact: true }).last();
  if (await puzzles.isVisible().catch(() => false)) { await puzzles.click({ force: true }); await wait(500); await shot("23-library-puzzles.png"); }
});

await step("export-sheet", async () => {
  await boot(); await nav("打谱");
  const more = page.getByRole("button", { name: "更多", exact: true }).first();
  if (await more.isVisible().catch(() => false)) await more.click({ force: true });
  const exportButton = page.getByRole("button", { name: /导出/ }).first();
  if (await exportButton.isVisible().catch(() => false)) { await exportButton.click({ force: true }); await wait(450); await shot("24-export-sheet.png"); }
});

console.log("done", JSON.stringify({ output: OUT, failures }, null, 2));
await context.close(); await browser.close();
if (failures.length) process.exitCode = 1;

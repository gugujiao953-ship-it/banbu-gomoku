import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.QA_BASE_URL || "http://127.0.0.1:5173/?qa=1";
const output = resolve("artifacts");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const target of [
    { name: "landscape", viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, colorScheme: "light" },
    { name: "tablet-dark-environment", viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: true, colorScheme: "dark" },
  ]) {
    const context = await browser.newContext({ viewport: target.viewport, isMobile: target.isMobile, hasTouch: target.hasTouch, colorScheme: target.colorScheme, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      localStorage.setItem("banbu-first-run-welcome-v1", "true");
      localStorage.setItem("banbu-theme-preference-v1", "porcelain");
      localStorage.setItem("banbu-board-theme-v1", "porcelain");
      localStorage.setItem("banbu-stone-theme-v1", "porcelain");
    });
    await page.goto(baseURL, { waitUntil: "commit" });
    await page.getByRole("tab", { name: "做题模式" }).click();
    await page.locator(".workspace-current").filter({ hasText: /第 1 题/ }).waitFor({ timeout: 10_000 });
    const before = await page.locator(".renju-board").boundingBox();
    await page.locator(".workspace-current").click();
    const selector = page.getByRole("dialog", { name: "选择题目与题集" });
    await selector.waitFor();
    await selector.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    const during = await page.locator(".renju-board").boundingBox();
    await page.screenshot({ path: resolve(output, `puzzle-selector-porcelain-${target.name}.png`), fullPage: false });
    await page.goBack();
    await selector.waitFor({ state: "detached" });
    const after = await page.locator(".renju-board").boundingBox();
    const theme = await page.evaluate(() => ({ dataTheme: document.documentElement.dataset.theme, colorScheme: getComputedStyle(document.documentElement).colorScheme }));
    const stable = before && during && after
      && Math.abs(before.x - during.x) <= 0.5 && Math.abs(before.y - during.y) <= 0.5 && Math.abs(before.width - during.width) <= 0.5
      && Math.abs(before.x - after.x) <= 0.5 && Math.abs(before.y - after.y) <= 0.5 && Math.abs(before.width - after.width) <= 0.5;
    results.push({ ...target, stable, measurements: { before, during, after }, theme, errors });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.stable || result.theme.dataTheme !== "porcelain" || result.theme.colorScheme !== "light" || result.errors.length)) process.exitCode = 1;


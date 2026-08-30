import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const filePath = process.argv[2] || String.raw`D:\五子棋\定式谱\雨.lib`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForFunction(() => window.__banbuImportState?.state === "renlib-web-query-ready", null, { timeout: 240_000 });
  const marked = page.locator('.renlib-variation[aria-label="变化点 I9"]');
  await marked.first().waitFor({ timeout: 30_000 });
  await page.getByRole("gridcell", { name: "I9空位" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("button", { name: "隐藏手数" }).click();
  await page.waitForTimeout(200);
  const result = await page.evaluate(() => ({
    stones: document.querySelectorAll(".stone-piece").length,
    currentLabels: [...document.querySelectorAll(".renlib-variation-label")].map((node) => node.textContent?.trim()).filter(Boolean),
    currentStoneLabels: [...document.querySelectorAll(".renlib-variation-label")]
      .filter((node) => Number(node.getAttribute("x")) === 322 && Number(node.getAttribute("y")) === 250)
      .map((node) => node.textContent?.trim()).filter(Boolean),
    lastDots: document.querySelectorAll(".stone-piece .last-dot").length,
    pageErrors: [],
  }));
  result.pageErrors = errors;
  console.log(JSON.stringify({ filePath, result }, null, 2));
  if (result.stones !== 2 || result.currentStoneLabels.length !== 0 || result.lastDots !== 0 || errors.length) process.exitCode = 1;

  // A user mark is an independent top layer and may intentionally sit on the
  // current stone. It must not turn the point back into a variation or remove
  // the stone itself.
  await page.getByRole("gridcell", { name: "I9已有棋子" }).click({ button: "right" });
  const markedStone = await page.evaluate(() => ({
    stones: document.querySelectorAll(".stone-piece").length,
    marks: document.querySelectorAll(".board-mark").length,
    currentLabels: [...document.querySelectorAll(".renlib-variation-label")].map((node) => node.textContent?.trim()).filter(Boolean),
  }));
  if (markedStone.stones !== 2 || markedStone.marks < 1 || markedStone.currentLabels.some((label) => label === "#")) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

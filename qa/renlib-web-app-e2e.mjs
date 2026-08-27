import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5180/";
const filePath = process.argv[2] || "D:/五子棋/定式谱/雨.lib";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await page.waitForFunction(() => window.__banbuImportState?.state === "renlib-web-query-ready", null, { timeout: 240_000 });
  await page.locator(".renlib-variation").first().waitFor({ timeout: 30_000 });

  const state = await page.evaluate(() => window.__banbuImportState);
  const pageText = await page.locator("body").innerText();
  const variations = await page.locator(".renlib-variation").evaluateAll((nodes) => nodes.map((node) => ({
    ariaLabel: node.getAttribute("aria-label"),
    text: node.querySelector(".renlib-variation-label")?.textContent || "",
    hasDot: Boolean(node.querySelector(".renlib-variation-dot")),
  })));
  const firstCoordinate = variations[0]?.ariaLabel?.replace("变化点 ", "");
  let advanced = false;
  if (firstCoordinate) {
    await page.getByRole("gridcell", { name: `${firstCoordinate}空位` }).click();
    await page.waitForFunction(() => document.body.innerText.includes("第 2 手"), null, { timeout: 30_000 });
    advanced = true;
  }
  const afterMoveVariations = await page.locator(".renlib-variation").count();
  await mkdir(resolve("artifacts"), { recursive: true });
  const screenshot = resolve("artifacts", `renlib-web-app-${basename(filePath, ".lib")}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const result = { state, hasFileTitle: pageText.includes(basename(filePath, ".lib")), variationCount: variations.length, variations, advanced, afterMoveVariations, errors, screenshot };
  console.log(JSON.stringify(result, null, 2));
  if (state?.state !== "renlib-web-query-ready" || variations.length < 1 || !advanced || errors.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

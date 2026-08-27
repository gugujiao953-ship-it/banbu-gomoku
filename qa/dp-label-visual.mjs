import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://127.0.0.1:5174/";
const file = process.argv[2] || String.raw`D:\五子棋\定式谱\九天指南v5-1.db`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForFunction(() => document.querySelectorAll(".stone").length === 0 && document.querySelectorAll(".renlib-native-label").length > 0, null, { timeout: 120_000 });
  const next = page.getByRole("button", { name: "下一手" });
  const targetDepth = Number(process.env.QA_DEPTH || 2);
  for (let depth = 1; depth <= targetDepth; depth += 1) {
    await next.click();
    await page.waitForFunction((expected) => document.querySelectorAll(".stone").length === expected, targetDepth === depth ? depth : depth);
  }
  const secondMove = process.env.QA_SECOND_MOVE || "";
  if (secondMove && targetDepth === 2) await page.locator(`[aria-label^="${secondMove}"]`).last().click();
  const labels = await page.locator(".renlib-native-label").allTextContents();
  const variations = await page.locator(".renlib-variation").count();
  const visibleDots = await page.locator(".renlib-variation-dot").count();
  const nativeLabelColors = await page.locator(".renlib-native-label").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill));
  const duplicateCoordinates = await page.locator(".renlib-variation-label").evaluateAll((nodes) => {
    const points = nodes.map((node) => `${node.getAttribute("x")},${node.getAttribute("y")}`);
    return points.length - new Set(points).size;
  });
  await page.screenshot({ path: "tmp/dp-label-visual.png", fullPage: true });
  console.log(JSON.stringify({ labels, labelCount: labels.length, variations, visibleDots, nativeLabelColors, duplicateCoordinates, errors }, null, 2));
  if (labels.length < 13 || variations !== 23 || duplicateCoordinates !== 0 || nativeLabelColors.some((color) => color !== "rgb(29, 28, 25)") || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

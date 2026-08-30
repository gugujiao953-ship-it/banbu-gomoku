import { chromium } from "playwright";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const baseUrl = process.env.QA_BASE_URL || process.env.BANBU_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  // Create H8 as the first move, then return to the root where H8 is shown as
  // an existing continuation rather than an occupied point.
  await page.getByRole("gridcell", { name: "H8空位" }).click();
  assert(await page.locator(".stone-piece").count() === 1, "first move was not created");
  await page.getByRole("button", { name: "上一手" }).click();
  assert(await page.locator(".stone-piece").count() === 0, "did not return to the root position");

  // A selected annotation must not steal an existing variation point. The
  // gray point is a node-navigation target, even while the annotation picker
  // is armed.
  await page.getByRole("button", { name: "标注", exact: true }).click();
  await page.locator(".mark-preset-grid.letters button").filter({ hasText: /^A$/ }).click();
  await page.getByRole("gridcell", { name: "H8空位" }).click();
  assert(await page.locator(".stone-piece").count() === 1, "existing continuation did not navigate when annotation mode was armed");
  assert(await page.locator(".board-label-text").filter({ hasText: /^A$/ }).count() === 0, "annotation was incorrectly written onto a variation point");

  await page.getByRole("button", { name: "上一手" }).click();
  await page.getByRole("button", { name: "标注", exact: true }).click();
  await page.locator(".mark-preset-grid.letters button").filter({ hasText: /^A$/ }).click();
  await page.getByRole("gridcell", { name: "I8空位" }).click();
  assert(await page.locator(".stone-piece").count() === 0, "ordinary empty point was not handled as an annotation");
  assert(await page.locator(".board-label-text").filter({ hasText: /^A$/ }).count() === 1, "annotation was not placed on an ordinary empty point");

  // After the one-shot annotation is consumed, the same marked coordinate
  // can still receive a real move. The new child must not inherit the mark.
  await page.getByRole("gridcell", { name: "I8空位" }).click();
  assert(await page.locator(".stone-piece").count() === 1, "placing on a marked empty point did not create a branch");
  assert(await page.locator(".board-label-text").filter({ hasText: /^A$/ }).count() === 0, "mark was rendered on top of the newly placed stone");

  // Return to the root: both branches remain, but the original mark wins the
  // visual collision and suppresses only the generic gray dot.
  await page.getByRole("button", { name: "上一手" }).click();
  assert(await page.locator(".renlib-variation").count() >= 2, "existing and new branches were not both preserved");
  assert(await page.locator(".renlib-variation-dot").count() === 1, "gray variation dot still covered the original mark");
  assert(await page.locator(".board-label-text").filter({ hasText: /^A$/ }).count() === 1, "root annotation was lost after branch navigation");

  await page.getByRole("gridcell", { name: "I8空位" }).click();
  assert(await page.locator(".stone-piece").count() === 1, "marked variation point no longer navigates to its existing branch");
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({ ok: true, baseUrl, branches: await page.locator(".renlib-variation").count(), pageErrors }));
} finally {
  await browser.close();
}

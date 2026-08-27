import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:5180/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(process.argv[2] || "D:/五子棋/定式谱/松月.lib");
  await page.waitForFunction(() => window.__banbuImportState?.state === "renlib-web-query-ready", null, { timeout: 240_000 });

  await page.getByRole("button", { name: "到第一手" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("第 0 手"));
  const root = {
    indicatorCount: await page.locator(".comment-indicator").count(),
    buttonLabel: await page.locator(".command-comment").getAttribute("aria-label"),
  };

  await page.getByRole("button", { name: "下一手" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("第 1 手"));
  const annotated = {
    indicatorCount: await page.locator(".comment-indicator").count(),
    buttonLabel: await page.locator(".command-comment").getAttribute("aria-label"),
  };
  await page.locator(".command-comment").click();
  const comment = (await page.locator(".comment-review").innerText()).trim();
  console.log(JSON.stringify({ root, annotated, comment, errors }, null, 2));
  if (root.indicatorCount !== 0 || root.buttonLabel !== "当前无注释" || annotated.indicatorCount !== 1 || !comment || errors.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

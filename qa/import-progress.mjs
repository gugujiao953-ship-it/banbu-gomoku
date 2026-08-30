import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || process.env.BANBU_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const largeComment = "x".repeat(5 * 1024 * 1024);
  const input = page.locator('input[type="file"][accept="*/*"]').first();
  await input.setInputFiles({ name: "阶段进度验收.sgf", mimeType: "application/x-go-sgf", buffer: Buffer.from(`(;GM[1]FF[4]SZ[15]C[${largeComment}];B[hh])`) });

  const card = page.locator(".import-progress");
  await card.waitFor({ state: "visible", timeout: 8000 });
  const stageLabels = await card.locator(".import-progress__steps li").allTextContents();
  if (stageLabels.join("|") !== "读取|解析|索引 / 保存|完成") throw new Error(`unexpected stages: ${stageLabels.join("|")}`);
  if (process.env.BANBU_IMPORT_SCREENSHOT) await page.screenshot({ path: process.env.BANBU_IMPORT_SCREENSHOT, fullPage: true });

  const progressbar = card.getByRole("progressbar");
  if (await progressbar.count()) {
    const value = await progressbar.getAttribute("aria-valuenow");
    if (value !== null) throw new Error(`single-file parsing exposed a fabricated percentage: ${value}`);
  }

  await page.waitForFunction(() => document.querySelector(".import-progress--complete, .import-progress--error"), undefined, { timeout: 15000 });
  if (await card.evaluate((node) => node.classList.contains("import-progress--error"))) throw new Error(await card.textContent() || "import failed");
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);

  await card.waitFor({ state: "hidden", timeout: 5000 });
  console.log(JSON.stringify({ ok: true, baseUrl, stageLabels, pageErrors }));
} finally {
  await browser.close();
}

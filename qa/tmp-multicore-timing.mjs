// 生产路径·多核开关的真实差值（2026-10-07）：走真实 UI，量「导入识别」与
// 「复原手序-本地」在开关开/关下的耗时（同一张 89 手白底图 + 用户那张 15 手图）。
// 用法：MSYS_NO_PATHCONV=1 QA_BASE_URL=http://localhost:4173/ node qa/tmp-multicore-timing.mjs
import { chromium } from "playwright";
import { resolve } from "node:path";

const base = process.env.QA_BASE_URL || "http://localhost:4173/";
const fixture = resolve(process.env.FIXTURE || "qa/fixtures/materials/remote-image2.png");

const run = async (fastRecognition) => {
  const url = new URL(base);
  if (!url.searchParams.has("qa")) url.searchParams.set("qa", "1");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
  await context.addInitScript((enabled) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ fastRecognition: enabled }));
  }, fastRecognition);
  const page = await context.newPage();
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
  await page.locator("nav.bottom-nav button").filter({ hasText: "打谱" }).first().click();
  await page.waitForSelector(".action-layout-workspace", { timeout: 20000 });
  await page.evaluate(() => document.querySelector(".bottom-nav .nav-center")?.click());
  await page.getByRole("dialog", { name: "选择导入方式" }).getByRole("button", { name: "图片识谱" }).click();
  await page.locator('input[type="file"][accept*="image/heic"]').setInputFiles(fixture);
  await page.waitForSelector(".board-fs-actions", { timeout: 15000 });
  const tImport = Date.now();
  await page.locator(".board-fs-actions button:has-text('识别')").click();
  await page.locator(".image-verify").waitFor({ timeout: 180000 });
  const importMs = Date.now() - tImport;
  await page.waitForTimeout(300);
  const stones = await page.locator("[data-verify-stone]").count();
  const tRestore = Date.now();
  await page.locator("[data-local-restore]").click();
  await page.waitForFunction(() => document.querySelector(".image-verify-hint")?.textContent?.includes("本地已按图上序号复原"), null, { timeout: 180000 }).catch(() => {});
  const restoreMs = Date.now() - tRestore;
  const after = await page.evaluate(() => ({
    hint: document.querySelector(".image-verify-hint")?.textContent?.trim().slice(0, 40) || "",
    numbers: document.querySelectorAll("[data-verify-number]").length,
    stones: document.querySelectorAll("[data-verify-stone]").length,
  }));
  await browser.close();
  return { importMs, restoreMs, stones, after };
};

const on = await run(true);
console.log(`多核开：导入 ${on.importMs}ms（${on.stones} 子）→ 复原 ${on.restoreMs}ms（${on.after.stones} 子/序号 ${on.after.numbers}）「${on.after.hint}」`);
const off = await run(false);
console.log(`多核关：导入 ${off.importMs}ms（${off.stones} 子）→ 复原 ${off.restoreMs}ms（${off.after.stones} 子/序号 ${off.after.numbers}）「${off.after.hint}」`);
console.log(`→ 导入省 ${off.importMs - on.importMs}ms、复原省 ${off.restoreMs - on.restoreMs}ms；合计 ${off.importMs + off.restoreMs}ms → ${on.importMs + on.restoreMs}ms`);

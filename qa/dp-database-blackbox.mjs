import { chromium } from "playwright";

const sample = process.env.DP_SAMPLE || process.argv[2];
if (!sample) throw new Error("用法：node qa/dp-database-blackbox.mjs <DP/DB 文件>");
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.stack || String(error)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      await Promise.all(databases.map((database) => database.name ? new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(database.name);
        request.onsuccess = request.onerror = request.onblocked = resolve;
      }) : Promise.resolve()));
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[type="file"]').first().setInputFiles(sample);
  await page.waitForFunction(() => {
    return window.__banbuImportState?.state === "dp-query-ready";
  }, undefined, { timeout: 15000 });
  await page.waitForFunction(() => Boolean(document.querySelector(".workspace-current b")?.textContent));
  const result = await page.evaluate(() => {
    return {
      title: document.querySelector(".workspace-current b")?.textContent || "",
      recordCount: window.__banbuImportState?.detail?.records || 0,
      rootBranches: document.querySelectorAll(".renlib-variation").length,
      state: window.__banbuImportState?.state || "",
    };
  });
  assert(result.recordCount > 3000, `DP/DB 局面数异常：${result.recordCount}`);
  assert(result.rootBranches > 0, "DP/DB 根节点没有显示分支入口");
  assert(result.state === "dp-query-ready", `DP/DB 导入状态异常：${result.state}`);
  assert(errors.length === 0, `浏览器运行错误：${errors.join("\n")}`);
  console.log(JSON.stringify({ pass: true, mobileViewport: "375x812", ...result }, null, 2));
} finally {
  await context.close();
  await browser.close();
}

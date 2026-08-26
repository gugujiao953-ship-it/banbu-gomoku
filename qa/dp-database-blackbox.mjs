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
    const records = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
    return records.some((record) => record.metadata?.title === "九天指南v5-1");
  }, undefined, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".workspace-current b")?.textContent === "九天指南v5-1");
  const result = await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("renju-note-library-v1") || "[]");
    const record = records.find((item) => item.metadata?.title === "九天指南v5-1");
    return {
      nodeCount: record ? Object.keys(record.nodes || {}).length : 0,
      rootChildren: record ? (record.nodes?.[record.rootId]?.children?.length || 0) : 0,
      status: document.querySelector(".workspace-status-copy small")?.textContent || "",
    };
  });
  assert(result.nodeCount > 3000, `导入节点数异常：${result.nodeCount}`);
  assert(result.rootChildren > 0, "DP 变化树根节点没有分支");
  assert(result.status.includes("分支"), `页面没有显示变化树状态：${result.status}`);
  assert(errors.length === 0, `浏览器运行错误：${errors.join("\n")}`);
  console.log(JSON.stringify({ pass: true, mobileViewport: "375x812", ...result }, null, 2));
} finally {
  await context.close();
  await browser.close();
}

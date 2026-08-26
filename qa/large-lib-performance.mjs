import { chromium } from "playwright";

const files = process.argv.slice(2);
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5173/";
if (!files.length) throw new Error("用法：node qa/large-lib-performance.mjs 雨.lib [松月.lib]");
const browser = await chromium.launch({ headless: true });
for (const file of files) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  const longTasks = [];
  await page.exposeFunction("recordLongTask", (entry) => longTasks.push(entry));
  await page.addInitScript(() => {
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.recordLongTask({ duration: entry.duration }))).observe({ type: "longtask", buffered: true });
  });
  await page.goto(baseUrl);
  const input = page.locator('input[type="file"]').first();
  const started = performance.now();
  await input.setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector(".import-progress"), null, { timeout: 600000 });
  const elapsed = performance.now() - started;
  const metrics = await page.evaluate(() => ({ domNodes: document.querySelectorAll("*").length, title: document.querySelector(".workspace-current b")?.textContent || "" }));
  console.log(JSON.stringify({ file, importMs: +elapsed.toFixed(1), ...metrics, longTasks: longTasks.length, maxLongTaskMs: +Math.max(0, ...longTasks.map((item) => item.duration)).toFixed(1) }));
  await page.close();
}
await browser.close();

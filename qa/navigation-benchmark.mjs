import { chromium } from "playwright";
const file = process.argv[2];
if (!file) throw new Error("用法：node qa/navigation-benchmark.mjs 雨.lib");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
await page.goto(process.env.QA_BASE_URL || "http://127.0.0.1:5173/");
await page.locator('input[type="file"]').first().setInputFiles(file);
await page.waitForFunction(() => !document.querySelector(".import-progress"), null, { timeout: 600000 });
const result = await page.evaluate(async () => {
  const next = document.querySelector('button[aria-label="下一手"]');
  const prev = document.querySelector('button[aria-label="上一手"]');
  if (!next || !prev) throw new Error("导航按钮不可用");
  const forward = [];
  for (let i = 0; i < 100; i += 1) {
    const start = performance.now(); next.click(); await new Promise(requestAnimationFrame); forward.push(performance.now() - start);
  }
  const backward = [];
  for (let i = 0; i < 100; i += 1) {
    const start = performance.now(); prev.click(); await new Promise(requestAnimationFrame); backward.push(performance.now() - start);
  }
  const stats = (values) => { const sorted = [...values].sort((a, b) => a - b); return { p50: sorted[49], p95: sorted[94], max: Math.max(...values), total: values.reduce((a, b) => a + b, 0) }; };
  return { forward: stats(forward), backward: stats(backward), domNodes: document.querySelectorAll("*").length, memory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null };
});
console.log(JSON.stringify({ file, ...result }));
await browser.close();

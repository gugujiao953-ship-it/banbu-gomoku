// 驱动 ORT 测速台：四组合（FP32/INT8 × 1/4 线程）逐个打开页面、收集结果。
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });

const combos = [
  { model: "/qa/fixtures/models/digit-head-iter2.onnx", threads: 1 },
  { model: "/qa/fixtures/models/digit-head-iter2.onnx", threads: 4 },
  { model: "/qa/fixtures/models/digit-head-iter2-int8.onnx", threads: 1 },
  { model: "/qa/fixtures/models/digit-head-iter2-int8.onnx", threads: 4 },
];

for (const combo of combos) {
  const page = await context.newPage();
  await page.goto(new URL(`qa/ort-bench.html?model=${encodeURIComponent(combo.model)}&threads=${combo.threads}`, base).toString(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__benchResult && globalThis.__benchResult.ok === true, null, { timeout: 180000 });
  const result = await page.evaluate(() => globalThis.__benchResult);
  console.log(JSON.stringify(result));
  await page.close();
}
await browser.close();

// 驱动数字头集成原型：打开 /qa/ort-digit-harness.html，等结果，打印摘要。
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", String(error).slice(0, 200)));
const query = new URLSearchParams({
  cv: process.env.CV || "/qa/tmp-cv-img1.json",
  image: process.env.IMAGE || "/qa/fixtures/recognition/remote-image1.jpeg",
  truth: process.env.TRUTH || "/qa/fixtures/recognition/remote-image1.truth.json",
  threads: process.env.THREADS || "4",
});
await page.goto(new URL(`qa/ort-digit-harness.html?${query}`, base).toString(), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => globalThis.__harnessResult && globalThis.__harnessResult.ok === true, null, { timeout: 300000 });
const result = await page.evaluate(() => globalThis.__harnessResult);
console.log(JSON.stringify(result, null, 1));
await browser.close();

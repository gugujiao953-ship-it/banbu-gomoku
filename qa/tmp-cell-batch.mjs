import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const items = [
  { id: "paper10", cv: "/qa/tmp-cv-paper10.json", image: "/qa/fixtures/recognition/paper10.jpg" },
  { id: "remote-image2", cv: "/qa/tmp-cv-remote-image2.json", image: "/qa/fixtures/materials/remote-image2.png" },
  { id: "remote-image1", cv: "/qa/tmp-cv-img1.json", image: "/qa/fixtures/recognition/remote-image1.jpeg" },
  { id: "m1000_p40", cv: "/qa/tmp-cv-m1000_p40.json", image: "/qa/fixtures/materials/m1000_p40.png" },
];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const warm = await context.newPage();
await warm.goto(new URL("qa/ort-cell-harness.html?cv=/qa/tmp-cv-fy11.json&image=/qa/fixtures/materials/fy11.png", base).toString(), { waitUntil: "domcontentloaded" });
await warm.waitForFunction(() => globalThis.__cellResult && globalThis.__cellResult.ok === true, null, { timeout: 300000 });
await warm.close();
for (const item of items) {
  const page = await context.newPage();
  const q = new URLSearchParams({ cv: item.cv, image: item.image, threads: "4" });
  try {
    await page.goto(new URL(`qa/ort-cell-harness.html?${q}`, base).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.__cellResult && globalThis.__cellResult.ok === true, null, { timeout: 300000 });
    const r = await page.evaluate(() => globalThis.__cellResult);
    console.log(`${item.id}: ${JSON.stringify(r.summary)} 漏子明细=${JSON.stringify((r.missedDetail || []).slice(0, 8))}`);
  } catch (e) { console.log(`${item.id}: ERR ${String(e).slice(0, 90)}`); }
  await page.close();
}
await browser.close();

import { chromium } from "playwright";
import path from "node:path";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const output = path.resolve("marketing/v1.1.4");
const pages = [
  ["poster.html", "banbu-poster-1080x1920.png"],
  ["features-core.html", "banbu-features-core-1080x1920.png"],
  ["features-tools.html", "banbu-features-tools-1080x1920.png"],
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [source, target] of pages) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}marketing/v1.1.4/${source}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(output, target), fullPage: false });
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, output, files: pages.map(([, target]) => target) }, null, 2));
} finally {
  await browser.close();
}

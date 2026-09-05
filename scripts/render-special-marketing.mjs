import { chromium } from "playwright";
import path from "node:path";

const baseUrl = process.env.BANBU_URL || "http://127.0.0.1:5181/";
const output = path.resolve("marketing/v1.1.4/special");
const pages = [
  ["formats-tree.html", "01-lib-db-json-tree-1080x1920.png"],
  ["themes-board-stones.html", "02-themes-board-stones-1080x1920.png"],
  ["tree-bookmarks.html", "03-tree-branches-bookmarks-1080x1920.png"],
];

const browser = await chromium.launch({ headless: true });
try {
  for (const [source, target] of pages) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}marketing/v1.1.4/special/${source}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(output, target), fullPage: false });
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, output, files: pages.map(([, target]) => target) }, null, 2));
} finally {
  await browser.close();
}

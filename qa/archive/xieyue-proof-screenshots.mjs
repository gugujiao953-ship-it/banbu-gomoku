/** Archived diagnostic: two proof screenshots for 斜月.lib — a branched position with labels,
 * and an expanded native comment. */
import { chromium } from "playwright";

const base = process.env.OUR_BASE || "http://localhost:5182/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1600 }, serviceWorkers: "block" });
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.locator('input[type="file"]').first().setInputFiles(String.raw`D:\五子棋\定式谱\斜月.lib`);
await page.waitForFunction(() => document.querySelectorAll(".renlib-variation").length > 0, null, { timeout: 900000 });
await page.waitForTimeout(1000);

const clickCoord = async (coord) => {
  const marker = page.locator(`.renlib-variation[aria-label="变化点 ${coord}"]`).first();
  if (await marker.count()) { await marker.click({ force: true }); return true; }
  return false;
};
for (const coord of ["I9", "G7"]) { await clickCoord(coord); await page.waitForTimeout(400); }
await page.waitForTimeout(600);
await page.screenshot({ path: "tmp/xieyue-branched.png" });

// walk to a commented node: H8,I9,G7,F8,E8 ("通浦月形。")
for (const coord of ["F8", "E8"]) { await clickCoord(coord); await page.waitForTimeout(400); }
const expand = page.locator('button[aria-label="展开注释"]');
if (await expand.count()) {
  await expand.click({ force: true });
  await page.waitForTimeout(400);
}
await page.screenshot({ path: "tmp/xieyue-comment.png" });
await browser.close();
console.log("shots saved");

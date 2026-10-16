import { chromium } from "playwright";
const base = process.env.QA_BASE_URL || "http://localhost:5173/";
const browser = await chromium.launch({ headless: true });
for (const scale of ["normal", "xlarge"]) {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, serviceWorkers: "block" });
  await context.addInitScript((sc) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-font-scale-v1", sc);
  }, scale);
  const page = await context.newPage();
  const url = new URL(base); url.searchParams.set("qa", "1");
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav.bottom-nav button", { timeout: 40000 });
  await page.locator("nav.bottom-nav button").filter({ hasText: "设置" }).first().click();
  await page.waitForTimeout(700);
  await page.locator(".topbar").screenshot({ path: `qa/tmp-topbar-${scale}.png` });
  await context.close();
}
console.log("topbar shots saved");
await browser.close();

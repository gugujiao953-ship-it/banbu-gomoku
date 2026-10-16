import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await page.goto("http://localhost:5212/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.documentElement.dataset.theme = "pelican"; });
await page.waitForTimeout(600);
// 棋谱库：留白多，最容易看清整幅画
await page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="主导航"]');
  Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "棋谱库")?.click();
});
await page.waitForTimeout(1600);
await page.screenshot({ path: "qa/tmp-theme-audit/pelican-library.png" });
console.log("已出图：pelican-library.png");
await browser.close();

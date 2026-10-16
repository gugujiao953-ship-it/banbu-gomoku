import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 4, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await page.goto("http://localhost:5211/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
await page.evaluate(() => { localStorage.setItem("banbu-theme-preference-v1", "pelican"); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
// 把动画冻结在几个相位，各拍一张放大图
for (const ph of [0, 0.25, 0.5, 0.75]) {
  await page.evaluate((p) => {
    for (const a of document.getAnimations()) {
      const d = a.effect.getTiming().duration;
      if (typeof d === "number") { a.currentTime = d * p; a.pause(); }
    }
  }, ph);
  await page.waitForTimeout(250);
  await page.locator(".ts-ride").screenshot({ path: `qa/tmp-theme-audit/zoom-${Math.round(ph * 100)}.png` });
}
console.log("已出 4 张放大图（相位 0/25/50/75%）");
await browser.close();

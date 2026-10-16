import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await page.goto("http://localhost:5211/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
await page.evaluate(() => { localStorage.setItem("banbu-theme-preference-v1", "pelican"); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);
const info = await page.evaluate(() => {
  const ride = document.querySelector(".ts-ride");
  const out = { theme: document.documentElement.dataset.theme, ride: ride ? "有" : "无" };
  if (ride) {
    out.parts = ["tr-wheel-rear", "tr-crank", "tr-thigh", "tr-shin", "tr-body", "tr-road"].map((c) => {
      const el = ride.querySelector("." + c);
      if (!el) return c + ":缺";
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return `${c}:${cs.animationName}(${Math.round(r.width)}×${Math.round(r.height)})`;
    });
    const rr = ride.getBoundingClientRect();
    out.rideBox = `${Math.round(rr.width)}×${Math.round(rr.height)}@${Math.round(rr.left)},${Math.round(rr.top)}`;
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: "qa/tmp-theme-audit/ride-final.png" });
await browser.close();

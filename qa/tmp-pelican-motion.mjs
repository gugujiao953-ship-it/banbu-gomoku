import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
for (const vp of [{ w: 390, h: 844, tag: "portrait" }, { w: 844, h: 390, tag: "landscape" }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto("http://localhost:5212/?qa=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await page.evaluate(() => { document.documentElement.dataset.theme = "pelican"; });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const parts = [".tr-crank", ".tr-thigh", ".tr-shin", ".tr-body", ".tr-road"].map((sel) => {
      const el = document.querySelector(".ts-ride " + sel);
      if (!el) return sel + ": 不存在";
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return `${sel}: anim=${cs.animationName || "—"} ${Math.round(r.width)}×${Math.round(r.height)} @(${Math.round(r.left)},${Math.round(r.top)})`;
    });
    const ride = document.querySelector(".ts-ride").getBoundingClientRect();
    return { ride: `${Math.round(ride.width)}×${Math.round(ride.height)} @(${Math.round(ride.left)},${Math.round(ride.top)})`, parts };
  });
  console.log(`\n═══ ${vp.tag} ${vp.w}×${vp.h} ═══  骑行层 ${info.ride}`);
  for (const x of info.parts) console.log("  " + x);
  await page.screenshot({ path: `qa/tmp-theme-audit/ride-${vp.tag}.png` });
  await ctx.close();
}
await browser.close();

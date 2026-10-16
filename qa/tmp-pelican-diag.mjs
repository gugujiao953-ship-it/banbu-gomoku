import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 160)));
await page.goto("http://localhost:5212/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);
await page.evaluate(() => { document.documentElement.dataset.theme = "pelican"; });
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const far = document.querySelector(".theme-scene .ts-far");
  const near = document.querySelector(".theme-scene .ts-near");
  const part = document.querySelector(".theme-scene .ts-parts i");
  const cs = (el) => { const s = getComputedStyle(el); return { bg: s.backgroundImage.slice(0, 60), bgSize: s.backgroundSize, anim: s.animationName, disp: s.display, h: Math.round(el.getBoundingClientRect().height) }; };
  return {
    themeAttr: document.documentElement.dataset.theme,
    shellBg: getComputedStyle(document.querySelector(".app-shell")).backgroundColor,
    far: cs(far), near: cs(near), part: cs(part),
    inkToken: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
    sheetCount: document.styleSheets.length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();

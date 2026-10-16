import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: "block" });
const page = await ctx.newPage();
await page.goto("http://localhost:5212/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const found = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      const t = r.cssText || "";
      if (t.includes("pelican")) found.push(t.slice(0, 120));
    }
  }
  return { count: found.length, sample: found.slice(0, 12) };
});
console.log("含 pelican 的规则条数：" + out.count);
for (const s of out.sample) console.log("  " + s);
await browser.close();

import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 300 } });
for (const f of ["pelican-body", "pelican-crank", "pelican-legs"]) {
  await page.goto(`http://localhost:5212/theme-assets/${f}.svg?v=6`, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => {
    const svg = document.querySelector("svg");
    const r = svg.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), kids: svg.children.length };
  });
  console.log(`${f}: 渲染 ${box.w}×${box.h}，顶层子元素 ${box.kids} 个`);
  await page.screenshot({ path: `qa/tmp-theme-audit/svg-${f}.png` });
}
await browser.close();

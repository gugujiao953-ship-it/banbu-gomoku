/**
 * qa/theme-scene-scroll.mjs — 验证滚动行为：长页面上场景是否仍钉在视口（wallpaper 效果），
 * 以及各主题新画面截图（含滚动后）。用法：node qa/theme-scene-scroll.mjs [base]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const D = "qa/tmp-theme-audit";
mkdirSync(D, { recursive: true });
const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// 切到「设置」页（内容长，可滚动）
await page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="主导航"]');
  Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "设置")?.click();
});
await page.waitForTimeout(1500);

for (const t of ["bamboo", "firefly", "aurora"]) {
  await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, t);
  await page.waitForTimeout(1200);
  const h = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, vh: innerHeight }));
  await page.screenshot({ path: `${D}/shot-${t}-top.png` });
  // 滚到中间，量图层的视口位置
  await page.evaluate(() => window.scrollTo(0, Math.min(600, document.documentElement.scrollHeight - innerHeight)));
  await page.waitForTimeout(700);
  const pos = await page.evaluate(() => {
    const l = document.querySelector(".theme-scene .ts-far");
    const r = l.getBoundingClientRect();
    return { scrollY: Math.round(scrollY), layerTop: Math.round(r.top), layerH: Math.round(r.height) };
  });
  await page.screenshot({ path: `${D}/shot-${t}-scrolled.png` });
  console.log(`${t.padEnd(9)} 文档高 ${h.doc} 视口 ${h.vh} · 滚到 ${pos.scrollY} 后：图层 top=${pos.layerTop}（0/负值=仍钉在视口 ✓） 高 ${pos.layerH}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}
await browser.close();
console.log(`\n截图：${D}/shot-{theme}-{top,scrolled}.png`);

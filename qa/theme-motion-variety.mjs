/**
 * qa/theme-motion-variety.mjs — 验证「各自运动」是否真的各自：
 * 打印每套主题的粒子/摆动件的动画名、周期、相位，看是不是同一组参数（那就会又变成机械运动）。
 * 并出三套主题的截图。用法：node qa/theme-motion-variety.mjs [base]
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
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

for (const t of ["pelican"]) {
  await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, t);
  await page.waitForTimeout(1300);
  const info = await page.evaluate(() => {
    const read = (el, label) => {
      const anims = el.getAnimations();
      return {
        label,
        shown: getComputedStyle(el).display !== "none",
        anims: anims.map((a) => `${a.animationName} ${(a.effect.getTiming().duration / 1000).toFixed(2)}s delay ${(Number(a.effect.getTiming().delay) / 1000).toFixed(2)}s`),
      };
    };
    const parts = Array.from(document.querySelectorAll(".theme-scene .ts-parts i")).map((el, i) => read(el, `粒子${i + 1}`));
    const sways = Array.from(document.querySelectorAll(".theme-scene .ts-sway b")).map((el, i) => read(el, `摆动${i + 1}`));
    const layers = Array.from(document.querySelectorAll(".theme-scene .ts-layer")).map((el) => ({
      cls: el.className.replace("ts-layer ", ""),
      shown: getComputedStyle(el).display !== "none",
      anims: el.getAnimations().map((a) => a.animationName).join(",") || "—",
    }));
    return { parts, sways, layers };
  });
  const shownParts = info.parts.filter((p) => p.shown);
  console.log(`\n═══ ${t} ═══  可见粒子 ${shownParts.length} / 摆动件 ${info.sways.filter((s) => s.shown).length}`);
  const seen = new Set();
  for (const p of shownParts) { for (const a of p.anims) seen.add(a); }
  console.log(`  粒子动画去重后：`);
  for (const a of [...seen].sort()) console.log(`    ${a}`);
  console.log(`  摆动件：`);
  for (const s of info.sways.filter((x) => x.shown)) console.log(`    ${s.anims.join(" · ") || "（无）"}`);
  console.log(`  图层：${info.layers.filter((l) => l.shown).map((l) => `${l.cls}(${l.anims})`).join("  ")}`);
  await page.screenshot({ path: `${D}/v2-${t}.png` });
}
await browser.close();
console.log(`\n截图：${D}/v2-{theme}.png；页面错误 ${errs.length}`);

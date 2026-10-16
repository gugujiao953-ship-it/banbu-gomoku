/**
 * qa/theme-scene-check.mjs — 主题场景层渲染自检：图层是否出现、背景是否加载、几何是否正确。
 * 用法：node qa/theme-scene-check.mjs [base]
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
const failed = [];
page.on("requestfailed", (r) => failed.push(`${r.url().split("/").pop()} ${r.failure()?.errorText}`));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

for (const t of ["rain", "bamboo", "snow", "firefly", "aurora"]) {
  await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, t);
  await page.waitForTimeout(1400);
  const info = await page.evaluate(() => {
    const scene = document.querySelector(".theme-scene");
    const shell = document.querySelector(".app-shell");
    const layers = Array.from(document.querySelectorAll(".theme-scene .ts-layer")).map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        cls: el.className.replace("ts-layer ", ""),
        size: `${Math.round(r.width)}×${Math.round(r.height)}`,
        top: Math.round(r.top),
        bgImg: cs.backgroundImage === "none" ? "—" : cs.backgroundImage.slice(0, 54).replace(/^url\("?[^/]*\//, "url(…/"),
        bgSize: cs.backgroundSize,
        anim: cs.animationName,
      };
    });
    return {
      sceneDisplay: getComputedStyle(scene).display,
      shellIsolation: getComputedStyle(shell).isolation,
      shellBg: getComputedStyle(shell).backgroundImage.slice(0, 40),
      layers,
    };
  });
  console.log(`\n═══ ${t} ═══  scene=${info.sceneDisplay} · app-shell isolation=${info.shellIsolation}`);
  for (const l of info.layers) console.log(`  ${l.cls.padEnd(7)} ${l.size.padEnd(11)} top=${String(l.top).padStart(5)}  size=${l.bgSize.padEnd(14)} anim=${l.anim.padEnd(28)} ${l.bgImg}`);
  await page.screenshot({ path: `${D}/new-${t}.png` });
}
await browser.close();
console.log(`\n加载失败：${failed.length ? failed.join(" | ") : "无"}；页面错误 ${errs.length}`);
console.log(`截图：${D}/new-{theme}.png`);

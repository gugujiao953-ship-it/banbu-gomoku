/**
 * qa/pelican-real.mjs — 在**真实 App**（真视口、真 CSS、真构建产物）里放大复核黄昏骑行。
 *
 * 为什么还要这一步：离线预览台（pelican-studio.mjs）只保证「素材+关键帧」对，
 * 但真机上的尺寸是 17dvh（≈236×145 CSS px）、还有 PWA 缓存与层级差异。这里按 iPhone 视口
 * 打开预览服务，把骑行各层的动画钉死在指定相位，然后**把 .ts-ride 那块裁出来放大 3 倍**，
 * 看的就是用户真正会看到的东西。
 *
 *   QA_BASE_URL=http://localhost:5211/ node qa/pelican-real.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.QA_BASE_URL || "http://localhost:5211/";
const OUT = "qa/tmp-studio";
const PHASES = (process.env.PHASES || "0,0.125,0.25,0.375,0.5,0.625,0.75,0.875,0.938,0.995").split(",").map(Number);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.addInitScript(() => {
  localStorage.setItem("banbu-theme-preference-v1", "pelican");
  localStorage.setItem("banbu-ai-engine-choice-v1", "strong");
});
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
// 首次打开／每次换版本都会弹欢迎页，它盖住棋盘（也就盖住骑行)——先关掉再量。
for (const t of ["先自己试试", "我知道了", "跳过"]) {
  const btn = page.getByRole("button", { name: t });
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(700); break; }
}
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(500);

const theme = await page.evaluate(() => document.documentElement.dataset.theme);
console.log("生效主题 =", theme, theme === "pelican" ? "✓" : "✗ 主题没生效，后面看的都不是鹈鹕");

const box = await page.evaluate(() => {
  const el = document.querySelector(".ts-ride");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log("真机 .ts-ride =", box && `${box.w.toFixed(1)}×${box.h.toFixed(1)} @${box.x.toFixed(0)},${box.y.toFixed(0)}`);
if (!box) { console.log("✗ 找不到 .ts-ride"); await browser.close(); process.exit(1); }

// 把骑行各层钉在指定相位（帧动画本来就是 CSS 动画，这里只是暂停+偏移，不改任何生产样式）
async function freeze(phase) {
  await page.evaluate((d) => {
    let s = document.getElementById("__pelican_freeze__");
    if (!s) { s = document.createElement("style"); s.id = "__pelican_freeze__"; document.head.appendChild(s); }
    s.textContent = `
      .ts-ride>*{animation-play-state:paused!important;animation-delay:${d}s!important}
      .tr-crank-far{animation-delay:${d - 0.75}s!important}
      .ts-ride,.ts-sway b,.ts-parts i{animation-play-state:paused!important}`;
  }, -phase * 1.5);
  await page.waitForTimeout(120);
}

const pad = 10;
const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2 };
const shots = [];
for (const p of PHASES) {
  await freeze(p);
  const f = `real-${p.toFixed(3)}.png`;
  await page.screenshot({ path: `${OUT}/${f}`, clip });
  shots.push(f);
}
await freeze(0);
await page.screenshot({ path: `${OUT}/real-full.png` });
// 横向也是用户会遇到的（横屏那条媒体查询改宽度来源）
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(600);
const box2 = await page.evaluate(() => { const r = document.querySelector(".ts-ride").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
console.log("横屏 .ts-ride =", `${box2.w.toFixed(1)}×${box2.h.toFixed(1)} @${box2.x.toFixed(0)},${box2.y.toFixed(0)}`);
await freeze(0);
await page.screenshot({ path: `${OUT}/real-landscape.png`, clip: { x: Math.max(0, box2.x - pad), y: Math.max(0, box2.y - pad), width: box2.w + pad * 2, height: box2.h + pad * 2 } });

console.log("截图：", shots.join(", "), "real-full.png, real-landscape.png");
console.log(errs.length ? "⚠ 页面报错：\n  " + errs.slice(0, 6).join("\n  ") : "无页面报错");
await browser.close();

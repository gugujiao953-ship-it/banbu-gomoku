/**
 * qa/theme-scene-fit.mjs — 场景层与 app-shell 的**对齐体检**：
 * 三种视口（手机竖屏 / 宽屏分栏 / 横屏矮屏）下，场景层的宽度/位置是否与 app-shell 一致，
 * 以及滚动后是否仍钉在视口、有没有溢出到卡片外。
 * 用法：node qa/theme-scene-fit.mjs [base]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const D = "qa/tmp-theme-audit";
mkdirSync(D, { recursive: true });
const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";

const CASES = [
  { tag: "phone-390x844", w: 390, h: 844, mobile: true },
  { tag: "wide-900x800", w: 900, h: 800, mobile: false },
  { tag: "wide-1280x800", w: 1280, h: 800, mobile: false },
  { tag: "landscape-844x390", w: 844, h: 390, mobile: true },
];

for (const c of CASES) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, isMobile: c.mobile, hasTouch: c.mobile, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="主导航"]');
    Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "设置")?.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.documentElement.dataset.theme = "deepsea"; });
  await page.waitForTimeout(1000);
  // 滚到底再量（最容易暴露问题）
  await page.evaluate(() => { const s = document.scrollingElement; s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), top: Math.round(b.top), h: Math.round(b.height) }; };
    return { shell: r(".app-shell"), scene: r(".theme-scene"), far: r(".theme-scene .ts-far"), scrollY: Math.round(scrollY) };
  });
  const ok = m.shell && m.scene && Math.abs(m.shell.x - m.scene.x) <= 2 && Math.abs(m.shell.w - m.scene.w) <= 2;
  console.log(`${c.tag.padEnd(20)} app-shell x=${m.shell.x} w=${m.shell.w} | 场景 x=${m.scene.x} w=${m.scene.w} | 滚到 ${m.scrollY} 后 ts-far top=${m.far.top}  h=${m.far.h}  → ${ok ? "对齐 ✓" : "✗ 宽度/位置不一致"}`);
  await page.screenshot({ path: `${D}/fit-${c.tag}.png` });
  await browser.close();
}
console.log(`\n截图：${D}/fit-*.png`);

/**
 * qa/shot-engine-section.mjs — 给设置页「分析」分区截图（用户 10-06：引擎那块右边空一大块）。
 * 用法：node qa/shot-engine-section.mjs [base] [normal|large|xlarge] [out.png]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5199/";
const SCALE = process.argv[3] ?? "large";
const OUT = process.argv[4] ?? `artifacts/shots/engine-${SCALE}.png`;

const clickByText = (page, text) => page.evaluate((t) => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === t);
  if (b) { b.click(); return true; }
  return false;
}, text);
const clickNav = (page, label) => page.evaluate((l) => {
  const nav = document.querySelector('nav[aria-label="主导航"]');
  const b = nav ? Array.from(nav.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === l) : null;
  if (b) b.click();
}, label);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate((s) => localStorage.setItem("banbu-font-scale-v1", s), SCALE);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!document.querySelector(".first-run-backdrop"))) { await clickByText(page, "先自己试试"); await page.waitForTimeout(400); }
await clickNav(page, "设置");
await page.waitForTimeout(900);
// 展开全部分区，找到「分析」那一段
await page.evaluate(() => { for (const d of Array.from(document.querySelectorAll("details"))) d.open = true; });
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const blocks = Array.from(document.querySelectorAll(".tuned-engine-block, .kata-tuning"));
  const target = blocks[0];
  if (!target) return { found: false, html: document.body.innerHTML.length };
  target.scrollIntoView({ block: "center" });
  const rect = target.getBoundingClientRect();
  const rows = Array.from(target.querySelectorAll(".tuned-engine-head, .tuned-engine-threads, .kata-tuning-cell")).map((el) => {
    const r = el.getBoundingClientRect();
    const inner = Array.from(el.children).map((c) => {
      const cr = c.getBoundingClientRect();
      return { tag: c.tagName, w: Math.round(cr.width), x: Math.round(cr.x), text: (c.textContent || "").trim().slice(0, 12) };
    });
    return { cls: el.className, w: Math.round(r.width), x: Math.round(r.x), inner };
  });
  const parent = target.parentElement?.getBoundingClientRect();
  return { found: true, blockW: Math.round(rect.width), blockX: Math.round(rect.x), parentW: parent ? Math.round(parent.width) : null, rows };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: OUT, fullPage: false });
console.log("截图 → " + OUT);
await browser.close();

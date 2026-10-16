/**
 * qa/shot-surfaces.mjs — 一次性截图工具（排查"右边空一大块"用）：
 * 设置页分析分区 / 分析面板 / 人机对战设置浮层，按给定字号各截一张。
 * 用法：node qa/shot-surfaces.mjs [base] [normal|large|xlarge]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5199/";
const SCALE = process.argv[3] ?? "xlarge";
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

/** 量一个容器里每行的占用情况，找出"右侧空着"的行。 */
const measure = (rootSel, rowSel) => page.evaluate(([rs, rowS]) => {
  const root = document.querySelector(rs);
  if (!root) return { found: false };
  const rr = root.getBoundingClientRect();
  const rows = Array.from(root.querySelectorAll(rowS)).map((el) => {
    const r = el.getBoundingClientRect();
    const kids = Array.from(el.children).map((c) => {
      const cr = c.getBoundingClientRect();
      return { t: (c.textContent || "").trim().slice(0, 10), x: Math.round(cr.x), w: Math.round(cr.width), right: Math.round(cr.right) };
    });
    return { cls: String(el.className).slice(0, 40), w: Math.round(r.width), right: Math.round(r.right), kids };
  });
  return { found: true, rootX: Math.round(rr.x), rootW: Math.round(rr.width), rows };
}, [rootSel, rowSel]);

// ① 设置页 → 分析
await clickNav(page, "设置");
await page.waitForTimeout(900);
await page.evaluate(() => { for (const d of Array.from(document.querySelectorAll("details"))) d.open = true; });
await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelector(".tuned-engine-block")?.scrollIntoView({ block: "center" }); });
await page.waitForTimeout(300);
await page.screenshot({ path: `artifacts/shots/settings-analysis-${SCALE}.png` });
console.log("设置页分析段:", JSON.stringify(await measure(".tuned-engine-block", ".tuned-engine-head, .tuned-engine-threads")));

// ② 分析面板
await clickNav(page, "打谱");
await page.waitForTimeout(700);
await Promise.all([clickByText(page, "分析"), clickByText(page, "开始分析")]);
await page.waitForTimeout(1200);
await page.screenshot({ path: `artifacts/shots/analysis-panel-${SCALE}.png` });
console.log("分析面板主控件行:", JSON.stringify(await measure(".ai-analysis-row--main", ":scope > *")));

// ③ 人机对战设置浮层
await clickNav(page, "对弈");
await page.waitForTimeout(700);
await Promise.all([clickByText(page, "开始对局"), clickByText(page, "继续对局")]);
await page.waitForTimeout(1200);
await page.screenshot({ path: `artifacts/shots/duel-setup-${SCALE}.png` });
console.log("人机浮层里的引擎块:", JSON.stringify(await measure(".tuned-engine-block", ".tuned-engine-head, .tuned-engine-threads, .kata-tuning-cell")));
await browser.close();

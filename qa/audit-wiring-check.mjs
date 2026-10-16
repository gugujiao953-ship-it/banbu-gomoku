import { chromium } from "playwright";

// 常驻门禁：审计接线验证（audit 2026-09-17）
//  A1 资料安全里新增两个入口：版本历史、库健康检查
//  A2 版本历史面板能打开，交代上限 12 份与空态
//  A3 库健康检查面板能打开，且明说「只报告、不自动删」
//  A4 回收站保留策略文案在位
//  A5 设置页有「最小深度」「最大深度」两行（分区默认折叠，需先展开）
//  A6 分析内存滑杆下限为 64（曾与面板的 64 不一致）
//  A7 全程无页面错误
// 用法：BANBU_URL=http://localhost:5173 node qa/audit-wiring-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1，下面按需补）。
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5173/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const T = {
  library: "\u68cb\u8c31\u5e93",       // 棋谱库
  dataSafety: "\u8d44\u6599\u5b89\u5168", // 资料安全
  versions: "\u7248\u672c\u5386\u53f2",   // 版本历史
  health: "\u5e93\u5065\u5eb7\u68c0\u67e5", // 库健康检查
  trash: "\u56de\u6536\u7ad9",          // 回收站
  settings: "\u8bbe\u7f6e",             // 设置
  analysis: "\u5206\u6790",             // 分析
  minDepth: "\u6700\u5c0f\u6df1\u5ea6",   // 最小深度
  maxDepth: "\u6700\u5927\u6df1\u5ea6",   // 最大深度
  retention: "\u4fdd\u7559\u7b56\u7565",  // 保留策略
  keep12: "12 \u4efd",                  // 12 份
  noDupe: "\u6ca1\u6709\u53d1\u73b0\u91cd\u590d", // 没有发现重复
  onlyReport: "\u4e0d\u81ea\u52a8\u5220",   // 不自动删
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2600);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const clickBtn = async (text) => {
  const ok = await page.evaluate((t) => {
    const node = [...document.querySelectorAll("button")].find((b) => ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).includes(t));
    if (!node) return false;
    node.click(); return true;
  }, text);
  await page.waitForTimeout(750);
  return ok;
};
const panelText = (selector) => page.evaluate((s) => document.querySelector(s)?.innerText || "", selector);

// ── 版本历史 ────────────────────────────────────────
check("V0 打开资料安全", await clickBtn(T.library) && await clickBtn(T.dataSafety));
check("V1 打开版本历史面板", await clickBtn(T.versions));
const vText = await panelText(".version-history-sheet");
check("V1a 面板已渲染", vText.length > 0, `${vText.length} chars`);
check("V1b 说明含「留一份旧版本」", vText.includes("\u7559\u4e00\u4efd\u65e7\u7248\u672c"));
check("V1c 列出上限 12 份", vText.includes(T.keep12));
check("V1d 空态或历史列表", vText.includes("\u8fd8\u6ca1\u6709\u5386\u53f2\u7248\u672c") || vText.includes("\u4e2a\u5c40\u9762"));
await page.keyboard.press("Escape"); await page.waitForTimeout(500);

// ── 库健康检查 ──────────────────────────────────────
check("V2 打开资料安全", await clickBtn(T.dataSafety));
check("V2 打开健康检查面板", await clickBtn(T.health));
const hText = await panelText(".version-history-sheet");
check("V2a 面板已渲染", hText.length > 0, `${hText.length} chars`);
check("V2b 明说「不自动删」", hText.includes(T.onlyReport));
check("V2c 有结果或空态", hText.includes(T.noDupe) || hText.includes("\u7ec4\u91cd\u590d"));
await page.keyboard.press("Escape"); await page.waitForTimeout(500);

// ── 回收站保留策略 ──────────────────────────────────
check("V3 打开回收站", await clickBtn(T.trash));
const tText = await panelText(".recycle-bin-sheet");
check("V3a 出现保留策略说明", tText.includes(T.retention), tText.slice(0, 90).replace(/\n/g, " "));
await page.keyboard.press("Escape"); await page.waitForTimeout(500);

// ── 设置页深度行（切到设置 tab，再展开全部分区）────────
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => {
  const nav = document.querySelector("nav.bottom-nav");
  const node = [...(nav?.querySelectorAll("button") ?? [])].find((b) => (b.textContent || "").includes("\u8bbe\u7f6e"));
  node?.click();
});
await page.waitForTimeout(1400);
check("V4 设置页已打开", await page.evaluate(() => Boolean(document.querySelector("[class*='settings-page']"))));
// 分区默认折叠，「分析」那一段要展开才看得到深度行。
await page.evaluate(() => {
  const cands = [...document.querySelectorAll("button,[role='button'],summary")].filter((e) => /section|head|disclosure|collapse/i.test(e.className) || e.tagName === "SUMMARY");
  cands.forEach((e) => { try { e.click(); } catch { /* 只读元素忽略 */ } });
});
await page.waitForTimeout(1200);
const sText = await page.evaluate(() => document.body.innerText);
check("V4a 设置页出现「最小深度」", sText.includes(T.minDepth));
check("V4b 设置页出现「最大深度」", sText.includes(T.maxDepth));
const memMin = await page.evaluate(() => document.querySelector('input[aria-label="\u5206\u6790\u5185\u5b58\u6ed1\u6746"]')?.getAttribute("min") ?? null);
check("V4c 分析内存滑杆下限 64", memMin === "64", String(memMin));

check("V5 无页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);

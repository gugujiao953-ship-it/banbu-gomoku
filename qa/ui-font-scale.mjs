import { chromium } from "playwright";
import fs from "node:fs";

/**
 * 门禁：「设置 → 界面字号」必须真的作用到**各功能自己的 CSS**，同时**不许动棋盘**。
 *
 * 为什么单独立门禁（2026-10-02）：字号缩放不是运行时 JS 改样式，而是构建期由
 * vite 插件 `scalableUiFonts`（vite.config.ts）把 `font-size:NNpx` 改写成
 * `calc(NNpx * var(--ui-font-scale, 1))`。这个插件最初只覆盖 `styles.css` 与
 * `library.css` 两个文件，于是对弈界面、比赛计时器、题库入口、状态栏这些
 * 「自己带 CSS」的界面里全是写死 px——实测同一档「特大字」，设置页 1.30 倍、
 * 这些界面 1.00 倍。接线范围一旦被改回去，肉眼看不出来，只能量。
 *
 * 断言（都是量出来的，不是「存在就算过」）：
 *   ① 构建产物里 `--ui-font-scale` 的引用数 ≥ 800（改回两文件白名单时只有约 250）；
 *   ② `.app-shell` 上的变量值 = 1 / 1.15 / 1.3 三档；
 *   ③ 三个不同界面（对弈入口、底部导航、设置）各自抽样 ≥4 类元素，
 *      「标准 → 特大字」字号倍率 ≥ 1.25；
 *   ④ 反向断言：棋盘 SVG 的**宽度**与**坐标文字字号**倍率 = 1.00（±0.02）——
 *      手册 ch17 明写「只放大界面文字与控件，不缩放棋盘」，这条把承诺钉住；
 *   ⑤ portal 到 document.body 的浮层（分析面板选框菜单）倍率 ≥ 1.25。字号变量原本只写在
 *      `.app-shell.font-scale-*` 上，而浮层挂在这个子树之外，实测特大字时菜单仍是 1.00
 *      ——现在 App 把同一个值也写到 :root，这条断言防止它再掉回去。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5543/?qa=1 node qa/ui-font-scale.mjs
 */
const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;
const SCALE_VALUES = { normal: 1, large: 1.15, xlarge: 1.3 };

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

const SAMPLES = {
  // 三个 CSS 来源都要有覆盖：duel.css（对弈入口）、game-screen.css（对弈界面）、library.css（设置）
  "对弈入口": [".duel-entry b", ".duel-entry small", ".duel-entry-index", ".duel-entry-action span", "h1"],
  "对弈界面": ["[data-duel-side='me'] b", "[data-duel-side='me'] small", "[data-duel-my-time]", ".duel-meta-item dt", "[data-duel-meta-value]", ".duel-recent-item"],
  "设置": [".settings-group summary b", ".setting-row b", ".setting-row small", ".settings-section-title b", ".settings-section-title small"],
};

const openScreen = async (page, name) => {
  if (name === "对弈入口" || name === "对弈界面") {
    await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
    await page.waitForTimeout(900);
    if (!(await page.evaluate(() => Boolean(document.querySelector("[data-duel-entry='ai']"))))) return false;
    if (name === "对弈入口") return true;
    await page.locator("[data-duel-entry='ai'] .duel-entry-action").click();
    await page.waitForTimeout(700);
    if (await page.locator("[data-duel-resume-new]").count()) {
      await page.locator("[data-duel-resume-new]").click();
      await page.waitForTimeout(700);
    }
    const start = page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ });
    if (!(await start.count())) return false;
    await start.click();
    await page.locator("[data-duel-screen]").waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return page.evaluate(() => Boolean(document.querySelector("[data-duel-screen]")));
  }
  if (name === "设置") {
    await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("设置"))?.click(); });
    await page.waitForTimeout(1000);
    return page.evaluate(() => Boolean(document.querySelector(".settings-group")));
  }
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
  await page.waitForTimeout(900);
  return page.evaluate(() => Boolean(document.querySelector("#board")));
};

const measure = async (page, screen) => {
  const sizes = await page.evaluate((selectors) => {
    const out = {};
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const value = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
      if (!out[sel] || out[sel] < value) out[sel] = value;
    }
    return out;
  }, SAMPLES[screen]);
  return sizes;
};

const runFor = async (scale) => {
  const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript((s) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-font-scale-v1", s);
  }, scale);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector(".app-shell", { timeout: 120000 });
  await page.waitForTimeout(1600);
  // 产物里到底包了多少处：把**每一张**外链样式表都取回来数。
  // 只看第一张会误判——预览/真机上 index.html 里可能先挂着一张小的（字体、legacy 兜底），
  // 全量套件里就出现过「第一张不是主包」→ 量到 0 处、而②④⑤全绿的假红。
  const cssProbe = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
    let total = 0;
    let sheets = 0;
    for (const href of links) {
      try {
        const text = await (await fetch(href)).text();
        sheets += 1;
        total += (text.match(/--ui-font-scale/g) || []).length;
      } catch { /* 取不到的那张不计，下面用 sheets 数量兜住假绿 */ }
    }
    return { total, sheets, links: links.length };
  });
  // HTTP 那条路有时拿不全（Service Worker 拦 fetch、或样式表被别的扩展改过）；
  // 这时退回读盘上的构建产物——这条断言问的是「构建有没有包上」，读盘同样算数，
  // 但要把来源打出来，不许悄悄换成另一套口径。
  let wrapped = cssProbe.total;
  let wrappedFrom = `HTTP ${cssProbe.sheets}/${cssProbe.links} 张样式表`;
  if (wrapped === 0) {
    const outDir = process.env.QA_OUT_DIR || "dist";
    try {
      const dir = `${outDir}/assets`;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".css"));
      wrapped = files.reduce((sum, f) => sum + (fs.readFileSync(`${dir}/${f}`, "utf8").match(/--ui-font-scale/g) || []).length, 0);
      wrappedFrom = `读盘 ${outDir}/assets 的 ${files.length} 张 CSS（HTTP 那条路取到 0 处）`;
    } catch { wrappedFrom = "HTTP 与读盘都没拿到，判失败"; }
  }
  const varValue = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--ui-font-scale").trim());
  const screens = {};
  for (const screen of Object.keys(SAMPLES)) {
    if (!(await openScreen(page, screen))) { screens[screen] = null; continue; }
    screens[screen] = await measure(page, screen);
  }
  // 棋盘：尺寸与坐标字号都必须不随界面字号档变化（要先回到打谱屏，量的是刚开完设置后的那一屏）
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
  await page.waitForTimeout(1200);
  const board = await page.evaluate(() => {
    const el = document.querySelector("#board");
    const coord = document.querySelector(".coordinates text");
    return {
      width: el ? Math.round(el.getBoundingClientRect().width * 10) / 10 : null,
      coordFont: coord ? Math.round(parseFloat(getComputedStyle(coord).fontSize) * 100) / 100 : null,
    };
  });
  // ⑤ portal 浮层：菜单挂在 document.body 上，不在 .app-shell 里，曾经完全不吃字号档
  let portal = null;
  await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "分析")?.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { (document.querySelector('.panel-select-trigger[aria-label="分析模式"]') || document.querySelector(".panel-select-trigger"))?.click(); });
  await page.waitForTimeout(500);
  portal = await page.evaluate(() => {
    const el = document.querySelector(".panel-select-menu button");
    if (!el) return null;
    return { font: Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100, portaled: el.closest(".panel-select-menu")?.parentElement === document.body };
  });
  await context.close();
  return { wrapped, wrappedFrom, sheets: cssProbe.sheets, links: cssProbe.links, varValue, screens, board, portal };
};

const normal = await runFor("normal");
const large = await runFor("large");
const xlarge = await runFor("xlarge");
await browser.close();

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };

console.log(`构建产物里 --ui-font-scale 引用数：${normal.wrapped}（来源：${normal.wrappedFrom}）`);
check("① 构建 CSS 接上了字号变量（≥800 处）", normal.wrapped >= 800, `实测 ${normal.wrapped} 处；若只有两三百，说明 scalableUiFonts 的覆盖范围又被收窄了`);
if (normal.wrappedFrom.startsWith("HTTP")) check("① 产物样式表全部取回来了（没静默漏掉某一张）", normal.sheets === normal.links && normal.links >= 1, `${normal.sheets}/${normal.links} 张`);

for (const [scale, data] of [["normal", normal], ["large", large], ["xlarge", xlarge]]) {
  const want = String(SCALE_VALUES[scale]);
  check(`② ${scale} 档 --ui-font-scale = ${want}`, Math.abs(parseFloat(data.varValue || "0") - SCALE_VALUES[scale]) < 0.01, `实测 ${data.varValue || "(空)"}`);
}

console.log("\n③ 各界面「标准 → 特大字」字号倍率");
let totalScaled = 0;
for (const screen of Object.keys(SAMPLES)) {
  const a = normal.screens[screen];
  const b = xlarge.screens[screen];
  if (!a || !b) { check(`③ ${screen} 能进入并量到字号`, false, "这一屏没进去或选择器全部落空"); continue; }
  const pairs = Object.keys(a).filter((k) => b[k]);
  const ratios = pairs.map((k) => ({ k, r: b[k] / a[k], from: a[k], to: b[k] }));
  const scaled = ratios.filter((x) => x.r >= 1.25);
  totalScaled += scaled.length;
  console.log(`  ${screen}：可量 ${pairs.length} 类，其中 ${scaled.length} 类倍率 ≥1.25  ${ratios.slice(0, 4).map((x) => `${x.k}=${x.r.toFixed(2)}`).join(" ")}`);
  check(`③ ${screen} 至少 4 类文字随字号档放大`, scaled.length >= 4, `实测 ${scaled.length}/${pairs.length}`);
}
check("③ 合计放大的元素类 ≥12", totalScaled >= 12, `实测 ${totalScaled}`);

console.log("\n④ 棋盘不随界面字号缩放");
const boardRatio = normal.board.width && xlarge.board.width ? xlarge.board.width / normal.board.width : null;
const coordRatio = normal.board.coordFont && xlarge.board.coordFont ? xlarge.board.coordFont / normal.board.coordFont : null;
check("棋盘宽度倍率 = 1.00", boardRatio !== null && Math.abs(boardRatio - 1) <= 0.02, `${normal.board.width}px → ${xlarge.board.width}px（${boardRatio?.toFixed(3)}）`);
if (coordRatio !== null) check("棋盘坐标字号倍率 = 1.00", Math.abs(coordRatio - 1) <= 0.02, `${normal.board.coordFont}px → ${xlarge.board.coordFont}px（${coordRatio.toFixed(3)}）`);
else console.log("SKIP 棋盘坐标字号：默认局面没有坐标文字（由棋盘边距设置决定），跳过这一条");

console.log("\n⑤ portal 到 body 的浮层也跟随字号（浮层不在 .app-shell 里，历史上拿不到 --ui-font-scale）");
if (!normal.portal || !xlarge.portal) check("分析面板选框菜单能展开并量到字号", false, "没量到 .panel-select-menu button（这一步不能空过）");
else {
  const portalRatio = xlarge.portal.font / normal.portal.font;
  check("浮层菜单字号倍率 ≥ 1.25", portalRatio >= 1.25, `${normal.portal.font}px → ${xlarge.portal.font}px（${portalRatio.toFixed(2)}）· 菜单确实在 body 下：${xlarge.portal.portaled}`);
}

console.log(failed ? `\n界面字号门禁失败：${failed} 条` : `\n界面字号门禁通过：三档变量生效、${totalScaled} 类文字随档位放大、棋盘保持 1.00`);
process.exit(failed ? 1 : 0);

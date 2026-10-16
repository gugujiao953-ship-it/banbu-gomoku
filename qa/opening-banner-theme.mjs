/**
 * 门禁：开局阶段提示卡（「五手两打 / 是否交换 / 选打点数」那一块）在**全部主题**下都得读得清。
 *
 * 为什么需要（2026-10-02 用户拿真机截图圈红问「这个字能看清楚吗」）：这张卡以前整块写死浅色
 * （`background:linear-gradient(#f3f8f4,#fff9ec)`、边框 #cbd9cf、说明文字 #756f66），而标题 `<b>`
 * **压根没声明 color**，继承的是主题的 --ink —— 深色主题下 --ink 是浅灰，于是浅灰字压在奶油底上，
 * 「五手两打」四个字几乎看不见。
 *
 * 为什么必须真的开一局：这块卡只在 `mode==="record" && aiGame && 开局阶段≠normal` 时渲染
 * （src/App.tsx 的 openingBannerElement），所以 R112/R117 那两轮"20 套主题逐屏量对比度"的巡查
 * 走不到它——探针只逛了设置浮层与打谱页。要抓这类 bug 就得把触发路径走通再量。
 *
 * 用法：QA_BASE_URL=http://127.0.0.1:5553/?qa=1 node qa/opening-banner-theme.mjs
 */
import { chromium } from "playwright";

const rawUrl = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://localhost:5173/";
const url = rawUrl.includes("?") ? rawUrl : `${rawUrl}?qa=1`;

const failures = [];
const check = (ok, message, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${message}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(message);
};

const helpers = () => {
  const parse = (css) => {
    const m = String(css).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const q = m[1].split(",").map((v) => parseFloat(v));
    if (q.length < 3 || q.some((v) => !Number.isFinite(v))) return null;
    return [q[0], q[1], q[2], q[3] === undefined ? 1 : q[3]];
  };
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  window.__ob = {
    // 向上合成祖先背景。渐变会让这个数失真，所以本门禁同时要求卡片是实色（见 gradient 断言）。
    bg(el) {
      const layers = [];
      let node = el;
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
        node = node.parentElement;
      }
      let b = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const l = layers[i];
        b = [l[0] * l[3] + b[0] * (1 - l[3]), l[1] * l[3] + b[1] * (1 - l[3]), l[2] * l[3] + b[2] * (1 - l[3])];
      }
      return b.map(Math.round);
    },
    ratio(fg, bg) { const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return Number((Math.max(a, b) / Math.min(a, b)).toFixed(2)); },
    parse,
  };
};

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });

// 主题清单从应用读（.app-shell[data-theme-options]，源头 src/theme-options.ts），不抄第二份。
const listPage = await browser.newPage();
await listPage.goto(url, { waitUntil: "domcontentloaded" });
const THEMES = (await listPage.evaluate(() => (document.querySelector(".app-shell")?.getAttribute("data-theme-options") || "").trim().split(/\s+/).filter(Boolean)));
await listPage.close();
check(THEMES.length >= 18, `从应用读到主题清单 ${THEMES.length} 套`);
if (!THEMES.length) { await browser.close(); process.exit(1); }

const results = [];
for (const theme of THEMES) {
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript((t) => {
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-theme-preference-v1", t);
  }, theme);
  await context.addInitScript(helpers);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 110)));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1100);
    await page.evaluate(() => { [...document.querySelectorAll(".bottom-nav button")].find((e) => (e.textContent || "").includes("对弈"))?.click(); });
    await page.waitForTimeout(600);
    await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
    await page.waitForTimeout(900);
    if (await page.locator("[data-duel-resume-new]").count()) { await page.locator("[data-duel-resume-new]").click(); await page.waitForTimeout(700); }
    await page.locator(".ai-game-setup").waitFor({ timeout: 10_000 });
    // 开局规则藏在「有禁手」那一格里，点开是浮层 .ai-float-list（六档：自由开局 / 五手两打 /
    // 五手多打（山口）/ 索索夫-8 / 塔十 / 塔拉）。选用户截图那一档。
    await page.evaluate(() => { [...document.querySelectorAll(".ai-game-setup button")].find((b) => (b.textContent || "").includes("有禁手"))?.click(); });
    await page.waitForTimeout(700);
    const picked = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".ai-float-list button")].find((b) => (b.textContent || "").includes("五手两打"));
      if (!row) return false;
      row.click();
      return true;
    });
    if (!picked) { results.push({ theme, skip: "「有禁手」浮层里没有「五手两打」这一档" }); await context.close(); continue; }
    await page.waitForTimeout(400);
    await page.locator(".ai-game-setup").getByRole("button", { name: /开始人机对战/ }).click();
    await page.locator("[data-duel-screen]").waitFor({ timeout: 12_000 });
    // 黑 1 落下去，提示卡就来了（实测文案「第 2 手 · 白方须落在中心 3×3 区域」）——
    // 不必等 AI 应满四手，触发同一张卡即可，跑得快也不易被引擎冷启动拖慢。
    const played = await page.evaluate(() => {
      const hits = [...document.querySelectorAll(".board-hit")];
      for (const point of ["H8", "I9", "H10", "G9"]) {
        const hit = hits.find((e) => (e.getAttribute("aria-label") || "").startsWith(point));
        if (hit && !(hit.getAttribute("aria-label") || "").includes("已有棋子")) { hit.dispatchEvent(new MouseEvent("click", { bubbles: true })); return point; }
      }
      return "";
    });
    if (!played) { results.push({ theme, skip: "棋盘上找不到可点的空位" }); await context.close(); continue; }
    let shown = false;
    for (let i = 0; i < 14 && !shown; i += 1) { await page.waitForTimeout(700); shown = await page.evaluate(() => Boolean(document.querySelector(".ai-opening-banner"))); }
    if (!shown) { results.push({ theme, skip: `下了 ${played} 之后没有出现开局提示卡（开局流程变了？）` }); await context.close(); continue; }
    const measure = await page.evaluate(() => {
      const card = document.querySelector(".ai-opening-banner");
      const { bg, ratio, parse } = window.__ob;
      const cs = getComputedStyle(card);
      const rows = [];
      for (const sel of ["b", "small"]) {
        const el = card.querySelector(sel);
        if (!el) continue;
        const fg = parse(getComputedStyle(el).color) || [0, 0, 0, 1];
        rows.push({ sel, ratio: ratio(fg.map(Math.round), bg(el)), fg: fg.map(Math.round), bg: bg(el), text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 16) });
      }
      return { rows, title: (card.querySelector("b")?.textContent || "").trim(), solidBg: cs.backgroundColor, bgImage: cs.backgroundImage };
    });
    results.push({ theme, ...measure, errors: errors.slice(0, 2) });
  } catch (error) {
    results.push({ theme, skip: `抛错：${String(error).slice(0, 90)}` });
  } finally {
    await context.close();
  }
}

console.log(`\n=== 开局提示卡 × ${THEMES.length} 套主题 ===`);
const measured = results.filter((r) => r.rows);
for (const r of results.filter((x) => x.skip)) console.log(`  SKIP ${r.theme.padEnd(11)} ${r.skip}`);
for (const r of measured) console.log(`  ${r.theme.padEnd(11)} 「${r.title}」 ${r.rows.map((x) => `${x.sel}=${x.ratio} 字${JSON.stringify(x.fg)}/底${JSON.stringify(x.bg)}`).join("  ")}`);

// 硬前置：一条都没测到就是门禁自己失效，不许它退化成"全绿"。这个仓库被「恒过的绿」咬过两次
// （写死色自检漏掉规则里最后一条声明、字号探针只读第一个样式表）。
if (!measured.length) {
  console.log("FAIL 一套主题都没测到提示卡——是触发路径坏了，不等于应用没问题");
  await browser.close();
  process.exit(1);
}
check(measured.length >= THEMES.length - 2, `测到 ${measured.length}/${THEMES.length} 套主题的提示卡`);
const dim = measured.flatMap((r) => r.rows.map((x) => ({ theme: r.theme, ...x }))).filter((x) => x.ratio < 4.5);
check(dim.length === 0, `标题与说明对比度全部 ≥4.5（不达标 ${dim.length} 条）`, dim.slice(0, 8).map((x) => `${x.theme}/${x.sel}=${x.ratio}`).join(" "));
const gradient = measured.filter((r) => /gradient/.test(r.bgImage));
check(gradient.length === 0, "卡片底色是实色令牌（渐变会让对比度无法判定）", gradient.map((r) => r.theme).join(" "));
const errs = measured.filter((r) => r.errors?.length);
check(errs.length === 0, "全程零页面错误", errs.slice(0, 2).map((r) => `${r.theme}: ${r.errors[0]}`).join(" | "));

await browser.close();
if (failures.length) { console.log(`\n开局提示卡门禁失败：${failures.length} 条`); process.exit(1); }
console.log("\n开局提示卡门禁通过：全部主题下标题与说明都读得清，且底色走令牌。");
process.exit(0);

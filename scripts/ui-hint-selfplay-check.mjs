import { chromium } from "playwright";

// Functional regression for hint mode + self-play. Dev server (HMR picks current
// tree) or production build both fine. Usage:
//   BANBU_URL=http://localhost:5197 node scripts/ui-hint-selfplay-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5197/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 392, height: 852 }); // 产品主形态是手机；桌面默认 1280×720 布局不同会误判
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
const setFlags = (extra) => page.evaluate((flags) => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 1, ...flags }));
}, extra);
const fresh = async (flags) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await setFlags(flags);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "打谱")?.click(); });
  await page.waitForTimeout(500);
};
const clickCell = (coord) => page.evaluate((pt) => {
  const cell = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt));
  cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}, coord);
const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const clickAnalyze = () => page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "") === "分析" || (e.getAttribute("aria-label") || "").startsWith("分析（提示模式"));
  b?.click();
  return !!b;
});
const panelOpen = () => page.evaluate(() => !!document.querySelector(".ai-analysis-panel"));
const waitStones = async (target, timeoutMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await stoneCount() >= target) return Date.now() - t0;
    await page.waitForTimeout(250);
  }
  return -1;
};
const readSettings = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "null"); } catch { return null; } });

// ── S1 提示模式：点分析→不落面板、直接替行棋方落一子 ──────────────────
await fresh({ analysisHintMode: true });
await clickCell("H8");
await page.waitForTimeout(600);
const s1Clicked = await clickAnalyze();
const s1Ms = await waitStones(2, 14000);
console.log("S1-hint:", JSON.stringify({ clicked: s1Clicked, placedInMs: s1Ms, stones: await stoneCount(), panelOpened: await panelOpen() }));

// ── S2 杀棋即落：黑四连轮白 → 提示挡；再提示 → 黑成五（应远快于 10s） ──
await fresh({ analysisHintMode: true });
for (const c of ["H8", "A1", "I8", "A2", "J8", "A3", "K8"]) { await clickCell(c); await page.waitForTimeout(500); }
const s2ready = await stoneCount();
await clickAnalyze();
const s2blockMs = await waitStones(8, 14000);
await page.waitForTimeout(400);
await clickAnalyze();
const s2winMs = await waitStones(9, 14000);
const s2won = await page.evaluate(() => document.body.innerText.includes("五连完成") || !!document.querySelector(".winning-stone-ring"));
console.log("S2-mate:", JSON.stringify({ ready: s2ready, blockInMs: s2blockMs, winInMs: s2winMs, winUnder10s: s2winMs >= 0 && s2winMs < 10000, fiveShown: s2won, stones: await stoneCount() }));

// ── S3 自对弈：黑四连轮白，开自对弈→白挡、黑成五→自动关闭 ─────────────
await fresh({ analysisSelfPlay: true, analysisSelfPlayTimeMs: 1500, analysisAuto: true }); // auto 同时开：测互斥不打死
for (const c of ["H8", "A1", "I8", "A2", "J8", "A3", "K8"]) { await clickCell(c); await page.waitForTimeout(500); }
await page.waitForTimeout(12000); // 白挡 + 黑杀 ≈ 2-3 回合
const s3st = await page.evaluate(() => ({
  stones: document.querySelectorAll(".stone-piece").length,
  five: document.body.innerText.includes("五连完成") || !!document.querySelector(".winning-stone-ring"),
}));
const s3flags = await readSettings();
console.log("S3-selfplay:", JSON.stringify({ ...s3st, selfPlayAutoOff: s3flags?.analysisSelfPlay === false, autoStillOn: s3flags?.analysisAuto === true }));

// ── S4 护栏：两开关关闭时分析按钮照常展开面板，主分析不受影响 ─────────
await fresh({});
await clickCell("H8");
await page.waitForTimeout(400);
await clickAnalyze();
await page.waitForTimeout(600);
const s4 = await page.evaluate(() => ({ panel: !!document.querySelector(".ai-analysis-panel"), stones: document.querySelectorAll(".stone-piece").length }));
console.log("S4-guard:", JSON.stringify(s4));

// ── S5 快捷中心：标题改「分析」+ 模式三选存在（打开快捷中心断言全文） ──
await page.evaluate(() => document.querySelector('[aria-label="打开快捷中心"]')?.click());
await page.waitForTimeout(700);
await page.evaluate(() => { const sec = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("分析")); sec?.click(); });
await page.waitForTimeout(500);
const s5text = await page.evaluate(() => { const d = document.querySelector(".quick-drawer, aside, [class*='drawer']"); return (d || document.body).innerText; });
const s5b = { modeRow: s5text.includes("分析模式"), selfplayOpt: s5text.includes("自对弈"), hintOpt: s5text.includes("提示"), notOldTitle: !s5text.includes("局面分析") };
console.log("S5-quick-center:", JSON.stringify(s5b));
await page.evaluate(() => document.querySelector('[aria-label="关闭快捷中心"]')?.click());
await page.waitForTimeout(400);

// ── S6 模式自绘下拉：展开/取消保持原模式/确认收起面板+直落；菜单贴合不漂移 ──
await fresh({ analysisHintMode: false });
await clickCell("H8");
await page.waitForTimeout(400);
await clickAnalyze();
await page.waitForTimeout(500);
const openModeDropdown = async () => {
  const found = await page.evaluate(() => {
    const t = [...document.querySelectorAll(".panel-select-trigger")].find((b) => b.getAttribute("aria-label") === "分析模式");
    t?.click();
    return !!t;
  });
  await page.waitForTimeout(500); // 等锚点校正（dock-reveal 动画 + 240ms settle）
  return found;
};
const s6segment = await openModeDropdown();
const menuBox = await page.evaluate(() => {
  const menu = document.querySelector(".panel-select-menu");
  const trig = [...document.querySelectorAll(".panel-select-trigger")].find((b) => b.getAttribute("aria-label") === "分析模式");
  if (!menu || !trig) return null;
  const m = menu.getBoundingClientRect(), t = trig.getBoundingClientRect();
  const opts = [...menu.querySelectorAll("button")].map((b) => b.textContent || "");
  // 真可见性：逐选项中心 elementFromPoint 命中其自身（穿透裁剪/遮挡检测）。
  const hitSelf = [...menu.querySelectorAll("button")].every((b) => { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === b || b.contains(el); });
  return { above: m.bottom <= t.top + 1, overlapsX: m.right > t.left && m.left < t.right, onScreen: m.top >= 0 && m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight, hitSelf, portal: menu.closest("body") === document.body && !menu.closest(".dock-panel"), opts, trigH: t.height, itemH: menu.querySelector("button")?.getBoundingClientRect().height ?? 0 };
});
await page.evaluate(() => { const b = [...document.querySelectorAll(".panel-select-menu button")].find((x) => x.textContent === "提示"); b && b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); b?.click(); });
let lastDialog = null;
const dialogAccept = async (d) => { lastDialog = d.message().slice(0, 12); await d.accept(); };
const dialogDismiss = async (d) => { lastDialog = d.message().slice(0, 12); await d.dismiss(); };
page.on("dialog", dialogDismiss);
await page.evaluate(() => { [...document.querySelectorAll(".panel-select-menu button")].find((b) => b.textContent === "提示")?.click(); });
await page.waitForTimeout(700);
page.off("dialog", dialogDismiss);
// 取消路径：下拉菜单收起、模式仍持续分析（面板不关闭，硬证据 panelStillOpen）
const s6cancel = await page.evaluate(() => ({ menuClosed: !document.querySelector(".panel-select-menu"), panelStillOpen: !!document.querySelector(".ai-analysis-panel") }));
page.on("dialog", dialogAccept);
await page.evaluate(async () => { const t = [...document.querySelectorAll(".panel-select-trigger")].find((b) => b.getAttribute("aria-label") === "分析模式"); t?.click(); await new Promise((r) => requestAnimationFrame(r)); [...document.querySelectorAll(".panel-select-menu button")].find((b) => b.textContent === "提示")?.click(); });
await page.waitForTimeout(800);
page.off("dialog", dialogAccept);
const s6ok = await page.evaluate(() => ({ panelClosed: !document.querySelector(".ai-analysis-panel"), hintOn: JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").analysisHintMode === true }));
const stonesBefore = await stoneCount();
await clickAnalyze();
const s6placed = await waitStones(stonesBefore + 1, 14000);
console.log("S6-modesegment:", JSON.stringify({ dropdown: s6segment, menuBox, cancel: s6cancel, confirmShown: !!lastDialog, ...s6ok, directPlaceInMs: s6placed }));
// 热区契约硬断言（全盘体检引入）：PanelSelect 触发框 ≥44px、菜单项 ≥40px，防小热区复发
if (!menuBox || menuBox.trigH < 43.5 || menuBox.itemH < 39.5) errors.push(`S6-hotzone 热区不足: trigger=${menuBox?.trigH ?? "n/a"} item=${menuBox?.itemH ?? "n/a"}`);
console.log("S6-hotzone:", menuBox ? `trigger=${menuBox.trigH.toFixed(1)} item=${menuBox.itemH.toFixed(1)}` : "n/a");

// ── S7 选点数量/选点显示下拉同样自绘且菜单贴合（回归「内容飘走」修复） ──
await fresh({}); // 回到持续分析模式
await clickCell("H8");
await page.waitForTimeout(400);
await clickAnalyze();
await page.waitForTimeout(600);
await page.evaluate(() => { const b = [...document.querySelectorAll(".panel-select-trigger")].find((x) => x.getAttribute("aria-label") === "选点数量"); b?.click(); });
await page.waitForTimeout(500);
const pickBox = await page.evaluate(() => {
  const menu = document.querySelector(".panel-select-menu");
  const trig = [...document.querySelectorAll(".panel-select-trigger")].find((b) => b.getAttribute("aria-label") === "选点数量");
  if (!menu || !trig) return null;
  const m = menu.getBoundingClientRect(), t = trig.getBoundingClientRect();
  const hitSelf = [...menu.querySelectorAll("button")].every((b) => { const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === b || b.contains(el); });
  return { count: menu.querySelectorAll("button").length, overlapsX: m.right > t.left && m.left < t.right, onScreen: m.top >= 0 && m.right <= innerWidth && m.bottom <= innerHeight, hitSelf, portal: !menu.closest(".dock-panel") };
});
console.log("S7-pick-dropdown:", JSON.stringify(pickBox));

console.log("errors:", errors.join(" | ") || "none");
await browser.close();
process.exit(errors.length ? 1 : 0);

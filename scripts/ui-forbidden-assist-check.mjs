import { chromium } from "playwright";

// 禁手点辅助门禁（2026-09-16）。背景：用户在应用里感觉「点落子有延迟」，实测根因是
// **轮到黑方的那一手**会在 render 里同步跑一次全盘禁手扫描（15 路 65–85ms，等于把棋子
// 出现推迟到算完）——所以是隔一手卡一下，而且只在开「禁手辅助」+ 连珠规则时出现。
// 两处修复：① `forbiddenPoints` 只克隆一次盘面、复用同一块 scratch（原先每个空点都要
// 走 evaluateRenjuMove：拼 225 格缓存键 + 克隆整盘）；② 提示计算移出 render，棋子先画、
// 下一帧再补提示。
// 本门禁同时钉住两件事：**提示仍然算得对**（三三局面必须标在 H8 上）与**不再有轮次相关的
// 卡顿**（用 CDP 的 ScriptDuration 归因，避免机器噪声；判据是中位数之比，dev/prod 都稳）。
// 用法：BANBU_URL=http://127.0.0.1:5297 node scripts/ui-forbidden-assist-check.mjs（自动补 ?qa=1）
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5173/";
const url = base.includes("?") ? base : `${base}?qa=1`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event).slice(0, 160)));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`);
};

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("banbu-first-run-welcome-v1", "true"); });
await page.reload({ waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForSelector('[role="gridcell"]', { timeout: 180000 });
await page.waitForTimeout(2000);

const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
/** 落一手，返回「点击到棋子进 DOM」的墙钟毫秒与这一手的脚本耗时（CDP 归因）。 */
const play = async (label) => {
  const before = await metrics();
  const ms = await page.evaluate((name) => new Promise((resolve) => {
    const count = document.querySelectorAll(".stone-piece").length;
    const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").startsWith(name));
    if (!cell) { resolve(-1); return; }
    const t0 = performance.now();
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const wait = () => { if (document.querySelectorAll(".stone-piece").length > count) resolve(+(performance.now() - t0).toFixed(1)); else requestAnimationFrame(wait); };
    requestAnimationFrame(wait);
  }), label);
  const after = await metrics();
  await page.waitForTimeout(280);
  return { ms, scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(1) };
};

// ── S1 提示算得对：黑 G8/I8 + H7/H9 → H8 是三三禁手点（与单测同一局面）──
for (const coordinate of ["G8", "A1", "I8", "A2", "H7", "A3", "H9", "A4"]) await play(coordinate);
const appeared = await page.waitForFunction(() => document.querySelectorAll(".forbidden-point").length > 0, { timeout: 3000 }).then(() => true).catch(() => false);
const markers = await page.evaluate(() => ({
  points: [...document.querySelectorAll(".forbidden-point")].map((circle) => ({ cx: Number(circle.getAttribute("cx")), cy: Number(circle.getAttribute("cy")) })),
  labels: [...document.querySelectorAll(".forbidden-point-label")].map((text) => text.textContent),
  state: window.__fbd,
}));
check("三三禁手局面在 H8 标出禁手点（提示仍然算得对）", appeared && markers.points.some((p) => Math.abs(p.cx - 286) < 6 && Math.abs(p.cy - 286) < 6), JSON.stringify(markers.points));
check("禁手标记带规则文字（三/四/长）", markers.labels.some((label) => /[三四长]/.test(label || "")), JSON.stringify(markers.labels));
check("提示走的是「轮到黑方才算」的分支（说明确实测到了原路径）", markers.state?.canRender === true && markers.state?.markers >= 1, JSON.stringify({ canRender: markers.state?.canRender, markers: markers.state?.markers }));

// ── S2 不再有轮次相关的卡顿 ──
// 这一手之后轮到谁，决定要不要跑全盘禁手扫描：白棋落完 → 轮到黑方 → 要算（旧版 65–85ms）；
// 黑棋落完 → 轮到白方 → 不算。分别取样后比中位数：旧版实测相差 9–12 倍（7ms vs 65ms）。
const withAssist = [];
const withoutAssist = [];
// 先热身两手，避开首帧/字体/音频初始化的开销
await play("B2");
await play("C3");
for (const [label, bucket] of [["B3", withAssist], ["D2", withoutAssist], ["C4", withAssist], ["D3", withoutAssist], ["B4", withAssist], ["D5", withoutAssist]]) {
  const sample = await play(label);
  if (sample.ms < 0) continue;
  bucket.push(sample);
}
const median = (list) => {
  const values = [...list].sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};
const assistScript = median(withAssist.map((s) => s.scriptMs));
const plainScript = median(withoutAssist.map((s) => s.scriptMs));
const assistWall = median(withAssist.map((s) => s.ms));
const plainWall = median(withoutAssist.map((s) => s.ms));
console.log(`     要算禁手的三手：墙钟 ${withAssist.map((s) => s.ms).join("/")}ms 脚本 ${withAssist.map((s) => s.scriptMs).join("/")}ms`);
console.log(`     不算的手：    墙钟 ${withoutAssist.map((s) => s.ms).join("/")}ms 脚本 ${withoutAssist.map((s) => s.scriptMs).join("/")}ms`);
check("轮次不再造成数量级差异（脚本耗时中位数之比 ≤ 3，旧版 9–12 倍）", assistScript <= plainScript * 3 + 8, `要算 ${assistScript}ms vs 不算 ${plainScript}ms`);
check("墙钟也没有数量级差异（中位数之比 ≤ 3）", assistWall <= plainWall * 3 + 8, `要算 ${assistWall}ms vs 不算 ${plainWall}ms`);
check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;

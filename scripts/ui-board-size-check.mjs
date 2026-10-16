import { chromium } from "playwright";

// 多路数引擎门禁：15 路必须保持零提示（回归），非 15 路必须有降级说明并且
// 引擎真的在跑（旧代码在 App 里被 `boardSize !== 15` 闸门直接掐死）。
// Usage: BANBU_URL=http://127.0.0.1:5299 node scripts/ui-board-size-check.mjs
// 也接受 run-qa 注入的 QA_BASE_URL（已带 ?qa=1）；?qa=1 必须带上（首运行欢迎页按版本重现，光写 localStorage 键压不住幕布）。
const base = process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5299/";
const url = base.includes("?") ? base : `${base}?qa=1`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 392, height: 852 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 180)));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  :: " + detail}`);
};

const boot = async () => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  // 每段场景从零开始：应用会恢复上一次的当前文档，不清就测不到「新建 N 路」。
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("banbu-first-run-welcome-v1", "true");
    localStorage.setItem("banbu-enhancement-settings-v1", JSON.stringify({ analysisAuto: false, analysisCandidateCount: 3 }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
};

const clickByAria = (aria) => page.evaluate((name) => {
  const button = [...document.querySelectorAll("button")].find((element) => (element.getAttribute("aria-label") || "") === name);
  button?.click();
  return Boolean(button);
}, aria);

const openAnalysisPanel = async () => {
  if (!(await clickByAria("分析"))) await clickByAria("分析（提示模式）");
  await page.waitForTimeout(500);
  return page.evaluate(() => Boolean(document.querySelector(".ai-analysis-panel")));
};

const setBoardSize = async (size) => {
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((element) => (element.textContent || "").trim() === "更多")?.click(); });
  await page.waitForTimeout(600);
  await page.selectOption(".board-size-select", String(size));
  await page.waitForTimeout(1400);
};

const noticeText = () => page.evaluate(() => document.querySelector(".ai-strength-notice")?.textContent?.trim() || null);
const toastText = () => page.evaluate(() => document.querySelector(".toast")?.textContent?.trim() || null);
const depthText = () => page.evaluate(() => document.querySelector(".ai-analysis-stats .stat-depth b")?.textContent?.trim() || null);
const clickCell = (coord) => page.evaluate((label) => {
  const cell = [...document.querySelectorAll('[role="gridcell"]')].find((element) => (element.getAttribute("aria-label") || "").startsWith(label));
  cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return Boolean(cell);
}, coord);
const toggleAnalysis = () => page.evaluate(() => {
  const input = document.querySelector(".ai-analysis-head input[type=checkbox]");
  if (!input) return false;
  input.click();
  return true;
});
// 深度显示自 09-16 起是「完成迭代-实际到达」的区间（如 "19-46"），直接 Number() 会得 NaN，
// 于是这条断言永远超时（假红：引擎其实已经跑到 19-46）。这里取区间里的最大值。
const depthValueOf = (text) => {
  const parts = String(text || "").split("-").map((part) => Number(part.trim())).filter((value) => Number.isFinite(value));
  return parts.length ? Math.max(...parts) : Number.NaN;
};
const waitDepth = async (timeoutMs) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await depthText();
    if (value && value !== "-" && depthValueOf(value) >= 1) return { depth: value, ms: Date.now() - started };
    await page.waitForTimeout(300);
  }
  return { depth: await depthText(), ms: -1 };
};

// ── S1 15 路：面板不该出现棋力说明（回归） ─────────────────────────────
await boot();
check("S1 15 路面板可打开", await openAnalysisPanel());
check("S1 15 路不显示棋力降级说明", (await noticeText()) === null, String(await noticeText()));

// ── S2 19 路（默认连珠）：常驻说明 + 引擎真的跑起来 ─────────────────────
await boot();
await setBoardSize(19);
check("S2 19 路面板可打开", await openAnalysisPanel());
const notice19 = await noticeText();
check("S2 19 路显示棋力降级说明", Boolean(notice19), String(notice19));
check("S2 19 路说明指出退回手工评估", Boolean(notice19 && notice19.includes("手工评估")), String(notice19));
check("S2 19 路棋盘真的建成 19 路", await page.evaluate(() => (document.querySelector('[role="grid"]')?.getAttribute("aria-label") || "").includes("19")));
await clickCell("J10");
await page.waitForTimeout(700);
await toggleAnalysis();
const toast19 = await (async () => {
  const started = Date.now();
  while (Date.now() - started < 6000) {
    const text = await toastText();
    if (text) return text;
    await page.waitForTimeout(200);
  }
  return null;
})();
check("S2 开启分析弹出降级提示", Boolean(toast19 && toast19.includes("19 路")), String(toast19));
const ran19 = await waitDepth(20000);
check("S2 19 路引擎真的在分析（depth ≥ 1）", ran19.ms >= 0, JSON.stringify(ran19));

// ── S3 9 路：小盘也要有说明（且不是 15 路专属权重的说法） ───────────────
await boot();
await setBoardSize(9);
await openAnalysisPanel();
check("S3 9 路棋盘真的建成 9 路", await page.evaluate(() => (document.querySelector('[role="grid"]')?.getAttribute("aria-label") || "").includes("9")));
const notice9 = await noticeText();
check("S3 9 路显示棋力降级说明", Boolean(notice9), String(notice9));
check("S3 9 路说明指出退回手工评估", Boolean(notice9 && notice9.includes("9 路") && notice9.includes("手工评估")), String(notice9));
const ran9 = await (async () => {
  await clickCell("E5");
  await page.waitForTimeout(700);
  await toggleAnalysis();
  return waitDepth(20000);
})();
check("S3 9 路引擎真的在分析（depth ≥ 1）", ran9.ms >= 0, JSON.stringify(ran9));

check("无页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exitCode = 1;

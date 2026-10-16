import { chromium } from "playwright";
import { readThemeIds, runThemeMatrix, sampleManyScript, weakThemes } from "./lib/theme-matrix.mjs";

// 常驻门禁：人机对战弹窗（2026-09-10 用户反馈批）
//  D1 难度档时长：初级 0.6s / 中级 2s / 高级 5s / 大师 10s（浮层文案）
//  D2 难度浮层：选预设档（初级..大师）后自动关闭；选「自由」保持打开（要继续调参数）
//  D3 对局时长浮层：选任一档后自动关闭
//  D4 规则浮层：选完后自动关闭（既有行为回归）
//  D5 无页面错误
//  D6 引擎调优行（用户 09-19）：内存是**一个**可拖又可读的控件，不再有重复的数值输入框；
//     多线程开关在；Android 有原生引擎时还有 ARM 加速（web 环境不渲染，按环境断言）
//  D7 一屏装完：360×640 / 392×720 / 412×900 三个视口下弹窗内容不得溢出（≤2px 容差）
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-ai-setup-dialog-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2400);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const openAiSetup = async () => { await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
 await page.waitForTimeout(700);
 await page.locator('[data-duel-entry="ai"] .duel-entry-action').click(); await page.waitForTimeout(900); };
const cellByText = (re) => page.evaluate((pattern) => { const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell.single")].find((b) => new RegExp(pattern).test(b.textContent || "")); cell?.click(); return !!cell; }, re.source);
const panelOpen = () => page.evaluate(() => !!document.querySelector(".ai-float-panel"));
const clickOption = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes(t)); b?.click(); return !!b; }, text);
const cellTexts = (re) => page.evaluate((pattern) => [...document.querySelectorAll(".ai-game-setup .ai-setup-cell.single")].map((b) => (b.textContent || "").trim()).filter((t) => new RegExp(pattern).test(t)), re.source);

await openAiSetup();

// ── D1 难度档时长文案 ────────────────────────────────────
await cellByText(/思考|难度|初级|中级|高级|大师|自由/);
await page.waitForTimeout(500);
const options = await page.evaluate(() => [...document.querySelectorAll(".ai-float-list button")].map((b) => (b.textContent || "").trim()));
const expected = [["初级", "0.6 秒"], ["中级", "2 秒"], ["高级", "5 秒"], ["大师", "10 秒"]];
const missing = expected.filter(([tier, seconds]) => !options.some((o) => o.includes(tier) && o.includes(seconds)));
check("D1 难度档时长文案（0.6/2/5/10 秒）", missing.length === 0, missing.length ? `缺 ${JSON.stringify(missing)}` : options.join(" | "));

// ── D2 选预设档自动关闭、选「自由」保持打开 ──────────────
const pickedMid = await clickOption("中级");
await page.waitForTimeout(500);
const closedAfterMid = !(await panelOpen());
const difficultyCell = await cellTexts(/中级|初级|高级|大师|自由/);
check("D2a 选「中级」后浮层自动关闭", pickedMid && closedAfterMid, `closed=${closedAfterMid} cell=${JSON.stringify(difficultyCell)}`);
await cellByText(/思考|难度|初级|中级|高级|大师|自由/);
await page.waitForTimeout(500);
const pickedFree = await clickOption("自由");
await page.waitForTimeout(500);
const staysOpen = await panelOpen();
const hasCustom = await page.evaluate(() => !!document.querySelector(".ai-free-controls"));
check("D2b 选「自由」后浮层保持打开并显示自定义控件", pickedFree && staysOpen && hasCustom, `open=${staysOpen} custom=${hasCustom}`);
await page.evaluate(() => { document.querySelector(".ai-float-head button")?.click(); }); // 关掉

// ── D3 对局时长浮层：主时长选完**保持打开**（同一浮层里还有「每手读秒」要选），
//        选完读秒才关闭 ─────────────────────────────────
// 断言口径在 09-19 修正：浮层加了第二张「每手读秒」列表之后，主时长的 onClick
// 只写值、不再 setAiFloatPanel(null)——旧断言「选完即关」已与实现不符（不是回归）。
await cellByText(/不限|分钟|时长/);
await page.waitForTimeout(500);
const timePanelOpen = await panelOpen();
const pickedTime = await clickOption("5 分钟");
await page.waitForTimeout(500);
const staysOpenForReadOff = await panelOpen();
const readOffVisible = await page.evaluate(() => Boolean(document.querySelector(".ai-float-subhead")));
const pickedReadOff = await clickOption("60 秒");
await page.waitForTimeout(500);
const closedAfterReadOff = !(await panelOpen());
const timeCell = await cellTexts(/分钟|不限/);
check("D3 时间浮层：主时长选完保持打开并露出「每手读秒」，选完读秒才关闭",
  timePanelOpen && pickedTime && staysOpenForReadOff && readOffVisible && pickedReadOff && closedAfterReadOff,
  `open0=${timePanelOpen} picked=${pickedTime} 保持=${staysOpenForReadOff} 读秒列表=${readOffVisible} pickedReadOff=${pickedReadOff} closed=${closedAfterReadOff} cell=${JSON.stringify(timeCell)}`);

// ── D4 规则浮层选完即关（既有行为） ──────────────────────
await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("有禁手")); x?.click(); });
await page.waitForTimeout(500);
const pickedRule = await clickOption("索索夫-8");
await page.waitForTimeout(500);
check("D4 规则浮层选完即关", pickedRule && !(await panelOpen()), `picked=${pickedRule} open=${await panelOpen()}`);

// ── D6 引擎调优行：内存一个控件 + 多线程/ARM ────────────────
const tune = await page.evaluate(() => {
  const row = document.querySelector(".ai-engine-tune");
  if (!row) return null;
  return {
    hasRange: !!row.querySelector('input[type="range"][aria-label="分析内存滑杆"]'),
    hasOutput: !!row.querySelector(".ai-tune-memory output"),
    // 合并成一个控件的判据：调优行里不该再有第二个数值输入框（原来那个 number input 已去掉）
    numberInputs: row.querySelectorAll('input[type="number"]').length,
    outputText: row.querySelector(".ai-tune-memory output")?.textContent || "",
    switches: [...row.querySelectorAll(".ai-tune-switch")].map((b) => (b.getAttribute("data-ai-tune") || "")),
    statusInline: !!document.querySelector(".ai-engine-status"),
  };
});
check("D6a 分析内存是一个「可拖又可读」的控件（滑杆 + 同一控件内的读数）", Boolean(tune?.hasRange && tune?.hasOutput && /\d/.test(tune?.outputText || "")), JSON.stringify(tune));
check("D6b 调优行里没有重复的数值输入框（已合并）", tune?.numberInputs === 0, `numberInputs=${tune?.numberInputs}`);
check("D6c 多线程开关在调优行里；ARM 加速按环境出现（web 无原生引擎时不渲染）", Boolean(tune?.switches.includes("multithread")) && tune?.switches.every((id) => ["multithread", "arm"].includes(id)), JSON.stringify(tune?.switches));
check("D6d 引擎状态并进标题行，不再单占一格", Boolean(tune?.statusInline));

// ── D6e 新控件要过**全部**主题的对比度（复用仓库的共享矩阵工具）────────
// 踩坑记录：一开始自己写了个只认 rgba() 的解析器，而底部弹窗背景是 CSS Color 4 的
// `color(srgb …)`，解析失败后退化到半透明遮罩上比，量出 3.01 这种假故障。
// scripts/lib/theme-matrix.mjs 正是为这个坑写的（认 color(srgb)、逐层合成底色），直接用。
{
  const themeIds = await readThemeIds(page);
  const selectors = [".ai-tune-memory > span", ".ai-tune-memory output", ".ai-tune-switch > span", ".ai-tune-switch > b", ".ai-engine-status > small"];
  const rows = await runThemeMatrix(page, themeIds, () => page.evaluate(sampleManyScript(selectors)));
  const missing = selectors.filter((selector) => rows.some((row) => !row.sample?.[selector]));
  // minWidth 必须调小：这些是「开/关」「128MB」这类窄文字节点（11px 宽），
  // 用默认 20px 会被 weakThemes 判成「元素不可见」——工具文档里点名的坑。
  const narrow = { minWidth: 4 };
  const weak = selectors.flatMap((selector) => weakThemes(rows, selector, 4.5, narrow));
  check("D6e 引擎调优行文字在全部主题下对比度 ≥4.5:1", missing.length === 0 && weak.length === 0,
    missing.length ? `量不到：${missing.join("、")}` : `不达标：${weak.join("、") || "无"}（共 ${rows.length} 套主题）`);
}

// ── D7 一屏装完：三个视口下弹窗内容不溢出 ────────────────────
for (const viewport of [{ width: 360, height: 640 }, { width: 392, height: 720 }, { width: 412, height: 900 }]) {
  const probe = await context.newPage();
  await probe.setViewportSize(viewport);
  await probe.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
  await probe.waitForTimeout(2200);
  await probe.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
  await probe.waitForTimeout(700);
  await probe.locator('[data-duel-entry="ai"] .duel-entry-action').click();
  await probe.waitForTimeout(800);
  const fit = await probe.evaluate(() => {
    const sheet = document.querySelector(".bottom-sheet");
    return { client: sheet?.clientHeight || 0, scroll: sheet?.scrollHeight || 0 };
  });
  check(`D7 人机对战弹窗在 ${viewport.width}×${viewport.height} 一屏装完（不滑动）`, fit.scroll - fit.client <= 2, `内容 ${fit.scroll}px / 可视 ${fit.client}px → 溢出 ${fit.scroll - fit.client}px`);
  await probe.close();
}

check("D5 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);

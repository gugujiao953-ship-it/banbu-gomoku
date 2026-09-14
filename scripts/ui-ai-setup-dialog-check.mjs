import { chromium } from "playwright";

// 常驻门禁：人机对战弹窗（2026-09-10 用户反馈批）
//  D1 难度档时长：初级 0.6s / 中级 2s / 高级 5s / 大师 10s（浮层文案）
//  D2 难度浮层：选预设档（初级..大师）后自动关闭；选「自由」保持打开（要继续调参数）
//  D3 对局时长浮层：选任一档后自动关闭
//  D4 规则浮层：选完后自动关闭（既有行为回归）
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
const openAiSetup = async () => { await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("AI"))?.click(); }); await page.waitForTimeout(900); };
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

// ── D3 对局时长浮层选完即关 ─────────────────────────────
await cellByText(/不限|分钟|时长/);
await page.waitForTimeout(500);
const timePanelOpen = await panelOpen();
const pickedTime = await clickOption("5 分钟");
await page.waitForTimeout(500);
const closedAfterTime = !(await panelOpen());
const timeCell = await cellTexts(/分钟|不限/);
check("D3 选对局时长后浮层自动关闭", timePanelOpen && pickedTime && closedAfterTime, `open0=${timePanelOpen} closed=${closedAfterTime} cell=${JSON.stringify(timeCell)}`);

// ── D4 规则浮层选完即关（既有行为） ──────────────────────
await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-game-setup .ai-setup-cells.two button")].find((b) => (b.textContent || "").includes("有禁手")); x?.click(); });
await page.waitForTimeout(500);
const pickedRule = await clickOption("索索夫-8");
await page.waitForTimeout(500);
check("D4 规则浮层选完即关", pickedRule && !(await panelOpen()), `picked=${pickedRule} open=${await panelOpen()}`);
check("D5 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);

import { chromium } from "playwright";

// Regression gate for the continuous-analysis duration removal (用户规格 09-10):
// 持续分析=一直分析当前局面，不再需要时长调度——切到持续分析不得弹「思考时长」
// 弹窗，快捷中心/设置页不得再有「持续分析每轮时限」行；只有自对弈保留每步时限
// 滑杆。Usage: BANBU_URL=http://localhost:5193 node scripts/ui-analysis-time-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
page.on("dialog", (d) => { void d.accept(); }); // 切提示模式的确认弹窗需要接受，其余流程不应出现任何 dialog
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const dialogOn = () => page.evaluate(() => !!document.querySelector('[aria-label="持续分析思考时长"]'));
const modeOf = () => page.evaluate(() => JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").analysisHintMode === true ? "hint" : JSON.parse(localStorage.getItem("banbu-enhancement-settings-v1") || "{}").analysisSelfPlay === true ? "selfplay" : "continuous");
const setMode = async (value) => { await page.selectOption('[aria-label="选择分析模式"]', value); await page.waitForTimeout(500); };

// 打开快捷中心并展开「分析」小节
await page.evaluate(() => document.querySelector('[aria-label="打开快捷中心"]')?.click());
await page.waitForTimeout(600);
await page.evaluate(() => { const t = [...document.querySelectorAll(".quick-drawer-section-toggle")].find((b) => (b.textContent || "").includes("分析")); if (t?.getAttribute("aria-expanded") !== "true") t?.click(); });
await page.waitForTimeout(400);
check("S0 快捷中心分析小节可达", await page.evaluate(() => !!document.querySelector('[aria-label="选择分析模式"]')));

// S1 默认（持续分析）态：无弹窗、无「每轮时限」行、无相关文案
check("S1 初始无弹窗", !(await dialogOn()));
check("S1b 快捷中心无持续分析时限行", await page.evaluate(() => !document.querySelector(".quick-analysis-time") && !document.body.textContent.includes("持续分析每轮时限")), (await page.evaluate(() => document.body.textContent.includes("持续分析每轮时限"))) ? "仍见时限行文案" : "ok");

// S2 切到自对弈：无弹窗；自对弈每步时限滑杆保留
await setMode("selfplay");
check("S2 切到自对弈无弹窗", !(await dialogOn()) && (await modeOf()) === "selfplay");
check("S2b 自对弈每步时限滑杆在", await page.evaluate(() => !!document.querySelector('[aria-label="自对弈每步时限"]')));

// S3 切回持续分析：不再弹时长窗；时限行不存在；自对弈滑杆隐藏
await setMode("continuous");
check("S3 切回持续分析不弹窗", !(await dialogOn()) && (await modeOf()) === "continuous");
check("S3b 仍无持续分析时限行", await page.evaluate(() => !document.querySelector(".quick-analysis-time")));
check("S3c 自对弈滑杆已隐藏", await page.evaluate(() => !document.querySelector('[aria-label="自对弈每步时限"]')));

// S4 设置页：分析区无「每轮时限」行；切到持续分析不弹窗
await page.evaluate(() => { const t = document.querySelector('[aria-label="关闭快捷中心"]'); t?.click(); });
await page.waitForTimeout(400);
await page.evaluate(() => { [...document.querySelectorAll(".bottom-nav button")].find((b) => (b.textContent || "").includes("设置"))?.click(); });
await page.waitForTimeout(600);
await page.evaluate(() => { const s = document.querySelector("details.settings-order-65 > summary"); if (s && !s.parentElement.open) s.click(); });
await page.waitForTimeout(400);
check("S4 设置页分析区可达", await page.evaluate(() => !!document.querySelector('details.settings-order-65 [aria-label="分析模式"]')));
check("S4b 设置页无持续分析时限行", await page.evaluate(() => !document.querySelector(".analysis-time-settings") && !document.querySelector('details.settings-order-65')?.textContent.includes("每轮时限")));
check("S4c 设置页无思考时长弹窗文案", await page.evaluate(() => !document.body.textContent.includes("持续分析 · 每轮思考时长")));
await page.selectOption('[aria-label="分析模式"]', "continuous");
await page.waitForTimeout(500);
check("S4d 设置页切持续分析不弹窗", !(await dialogOn()));

// S5 面板头部 segment 切模式：提示（confirm 被 dismiss）与持续分析都不弹时长窗
await page.evaluate(() => { [...document.querySelectorAll(".bottom-nav button")].find((b) => (b.textContent || "").includes("打谱"))?.click(); });
await page.waitForTimeout(500);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").startsWith("分析")); b?.click(); });
await page.waitForTimeout(800);
await page.evaluate(async () => { const t = [...document.querySelectorAll(".panel-select-trigger")].find((b) => b.getAttribute("aria-label") === "分析模式"); t?.click(); await new Promise((r) => requestAnimationFrame(r)); [...document.querySelectorAll(".panel-select-menu button")].find((b) => b.textContent === "提示")?.click(); });
await page.waitForTimeout(500);
check("S5 提示模式不弹时长窗", !(await dialogOn()) && (await modeOf()) === "hint");
// 提示模式下分析按钮不再展开面板（segment 已收起），改从快捷中心切回持续分析
await page.evaluate(() => document.querySelector('[aria-label="打开快捷中心"]')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => { const t = [...document.querySelectorAll(".quick-drawer-section-toggle")].find((b) => (b.textContent || "").includes("分析")); if (t?.getAttribute("aria-expanded") !== "true") t?.click(); });
await page.waitForTimeout(300);
await setMode("continuous");
check("S5b 快捷中心切回持续分析不弹窗", !(await dialogOn()) && (await modeOf()) === "continuous");

check("S6 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);

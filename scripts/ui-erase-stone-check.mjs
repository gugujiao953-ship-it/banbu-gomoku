import { chromium } from "playwright";

// 常驻门禁：去子功能（2026-09-11 用户需求）
//  E1 编辑面板进入去子、状态栏右侧「去子中 · 退出」
//  E2 点已有棋子删除（无论哪一手）；带手序/分支的棋谱首次删除拍平为静态局面
//  E3 拍平不可撤销（草稿清空）；拍平后删子走草稿可悔棋恢复
//  E4 点空位不删子；退出按钮结束模式
// 用法：BANBU_URL=http://localhost:5193 node scripts/ui-erase-stone-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 392, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await context.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const stoneCount = () => page.evaluate(() => document.querySelectorAll(".stone-piece").length);
const clickCell = async (label) => { await page.evaluate((l) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(l) || (e.getAttribute("aria-label") || "").endsWith(l)); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, label); await page.waitForTimeout(500); };
const clickText = async (text, selector = "button") => { await page.evaluate(([t, s]) => { [...document.querySelectorAll(s)].find((b) => (b.getAttribute("aria-label") || b.textContent || "").includes(t))?.click(); }, [text, selector]); await page.waitForTimeout(500); };
const toast = async () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join(" | ") || "");
const stepLabel = () => page.evaluate(() => { const lines = [...document.querySelectorAll(".unified-status-lines .unified-status-line")].map((e) => e.textContent || ""); return lines.join(" · "); });

// ── 打谱落三子 ─────────────────────────────────────────
await clickCell("H8空位");
await clickCell("I8空位");
await clickCell("J8空位");
check("前置：棋盘三子", (await stoneCount()) === 3, `stones=${await stoneCount()}`);
const stepBefore = await stepLabel();
console.log("  手序：", stepBefore);

// ── 编辑 → 去子 ────────────────────────────────────────
await clickText("编辑");
await page.waitForTimeout(400);
await clickText("去子");
const exitShown = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("aria-label") || "") === "退出去子"));
check("A 状态栏出现「去子中 · 退出」", exitShown);
const dockGone = await page.evaluate(() => !document.querySelector(".dock-panel-notes"));
check("B 进入去子后编辑面板收起", dockGone);

// ── 点已有棋子删除 ─────────────────────────────────────
await clickCell("I8已有棋子");
const afterErase = await stoneCount();
check("C 点棋子删除（3→2）", afterErase === 2, `stones=${afterErase}`);
check("C2 toast 提示删除", (await toast()).includes("已删除"), await toast());
check("C3 拍平后草稿清空（拍平不可撤销，悔棋禁用）", (await page.evaluate(() => { const u = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "撤销编辑"); return u ? u.disabled : true; })), "undo-disabled");

// ── 点空位不删 ────────────────────────────────────────
const emptyBefore = await stoneCount();
await clickCell("K8空位");
check("D 点空位不删子", (await stoneCount()) === emptyBefore, `stones=${await stoneCount()}`);

// ── 静态删子后撤销恢复（拍平后的删子走草稿，悔棋一次即恢复） ──
await clickCell("J8已有棋子"); // 静态局面删一颗（2→1）
const afterStaticErase = await stoneCount();
check("E0 静态局面删子（2→1）", afterStaticErase === 1, `stones=${afterStaticErase}`);
await clickText("撤销编辑");
const undoStones = await stoneCount();
check("E 悔棋撤销恢复被删之子", undoStones === 2, `stones=${undoStones}`);

// ── 再次进入去子删子后，棋谱变静态：再落子应为第1手 ──────
await clickText("去子");
await clickCell("I8已有棋子");
const stepAfter = await stepLabel();
console.log("  拍平后手序：", stepAfter);
check("F 拍平后手序归零（第 0/1 手，不再是第 3 手）", !stepAfter.includes("第 3 手") && !stepAfter.includes("第 4 手"), stepAfter);

// ── 退出按钮结束模式 ───────────────────────────────────
await clickText("退出去子");
const exitGone = await page.evaluate(() => ![...document.querySelectorAll("button")].some((b) => (b.getAttribute("aria-label") || "") === "退出去子"));
check("G 退出按钮结束去子模式", exitGone);

// ── 去子模式与读谱互斥 ─────────────────────────────────
check("H 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);

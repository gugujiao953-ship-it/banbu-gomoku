import { chromium } from "playwright";

// Regression gate for T29 「强制停止思考=先落当前最强点」.
// Master strength gives a stable multi-second thinking window. Flow: warm one
// full AI exchange (engine load + result), then on the next AI think click the
// stop indicator ~1.2s in and assert the AI PLAYS its best-so-far move within
// ~4s (old behavior: stop discarded everything and the turn stalled).
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-stop-to-play-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join("|").slice(0, 140));
const occ = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((h) => h.getAttribute("aria-label") || "").filter((l) => l.includes("已有棋子")).map((l) => (l.match(/[A-O]\d{1,2}/) || [""])[0]));
const lit = () => page.evaluate(() => Boolean(document.querySelector(".board-thinking-indicator")));
const clickPoint = async (n) => { await page.evaluate((pt) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find((e) => (e.getAttribute("aria-label") || "").startsWith(pt)); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, n); };
const clickStop = async () => page.evaluate(() => { document.querySelector(".board-thinking-indicator")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

// 开局：大师强度、默认自由规则
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((x) => (x.textContent || "").includes("AI"))?.click(); });
await page.waitForTimeout(900);
await page.evaluate(() => { const cell = [...document.querySelectorAll(".ai-game-setup .ai-setup-cell.single")].find((b) => /思考|难度|初级|中级|高级|大师|自由/.test(b.textContent || "") || b.getAttribute("aria-expanded") !== null); cell?.click(); });
await page.waitForTimeout(400);
const masterPicked = await page.evaluate(() => { const b = [...document.querySelectorAll(".ai-float-list button")].find((e) => (e.textContent || "").includes("大师")); if (b) { b.click(); return true; } return false; });
check("S0a 难度浮层选大师（10s 窗口）", masterPicked, "浮层未开或无大师项——后续窗口计时会失真");
await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战")); x?.click(); });
await page.waitForTimeout(800);

// 热身一整回合（冷启动引擎加载+完整 result），保证测试回合 active 稳定
await clickPoint("H8");
for (let i = 0; i < 30 && (await lit()); i += 1) await page.waitForTimeout(500);
const warmed = await occ();
check("S1 热身完成（引擎已常驻，≥2 子）", warmed.length >= 2, JSON.stringify(warmed));

// 测试回合：人落第3子 → ~1.2s 后点停止 → AI 必须在 ~4s 内落「当前最强点」
await clickPoint("J9");
await page.waitForTimeout(300);
let clickedAt = 0;
for (let i = 0; i < 10; i += 1) { if (await lit()) { clickedAt = Date.now(); break; } await page.waitForTimeout(150); }
check("S2 点停时确在思考中", clickedAt > 0, `lit=${clickedAt > 0}`);
await page.waitForTimeout(900);
await clickStop();
let stopToast = "";
for (let i = 0; i < 6; i += 1) { stopToast = await toast(); if (/当前最强点/.test(stopToast)) break; await page.waitForTimeout(200); }
check("S3 停止提示=落当前最强点（非旧「线程已终止」）", /当前最强点/.test(stopToast), `toast=「${stopToast.slice(0, 80)}」`);
let playedMs = -1;
for (let i = 0; i < 30; i += 1) {
  const now = await occ();
  if (now.length >= warmed.length + 2) { playedMs = Date.now() - clickedAt; break; }
  await page.waitForTimeout(200);
}
check("S4 停止后 AI 落了子（回合未卡死）", playedMs >= 0, `playedMs=${playedMs}`);
check("S5 落子及时（<5s，未等满大师 10s 预算）", playedMs >= 0 && playedMs < 5000, `playedMs=${playedMs}`);
for (let i = 0; i < 10 && (await lit()); i += 1) await page.waitForTimeout(300);
check("S6 思考指示灯已熄灭", !(await lit()));
check("S7 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);

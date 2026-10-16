import { chromium } from "playwright";

// Regression gate for the human-vs-AI undo (上一手) flow.
//
// 语义（用户 09-13 定案）：回退 = 回到「轮到自己」的局面。点任意点（包括树里
// 已存在的旧着法/分支点）都与正常对局完全一致：落子 → 引擎应手，绝不停在
// 「轮到 AI 却毫无动静」的僵尸局面，也不再有「修改分支」类提示。
//
// 历史：修复前回退只退一手，会停在 AI 的回合；点旧着法只切光标不落子，
// 用户体感是「回退后总让我处理分支、点了没反应」。
// Usage: BANBU_URL=http://localhost:5193 node scripts/ui-aigame-undo-check.mjs
const url = process.env.BANBU_URL || "http://localhost:5193/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 392, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.addInitScript(() => {
  localStorage.setItem("banbu-first-run-welcome-v1", "true");
  // 2026-10-13 起人机对弈的「悔棋」= **10 棋魂一次**（直接扣账本，见 App 的 takeDuelUndo），
  // 余额不足会如实拒绝 —— 本门禁测的是**回退语义**（退完必须轮到自己），所以先把钱灌够。
  localStorage.setItem("banbu-soul-ledger-v1", JSON.stringify([{ id: "gate-undo", at: Date.now(), amount: 500, reason: "manual", detail: "门禁灌余额" }]));
});
await page.goto(`${url}?qa=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`); if (!ok) failed += 1; };
const toast = () => page.evaluate(() => [...document.querySelectorAll("[class*='toast']")].map((e) => e.textContent?.trim()).filter(Boolean).join("|").slice(0, 140));
const occ = () => page.evaluate(() => [...document.querySelectorAll(".board-hit")].map((h) => h.getAttribute("aria-label") || "").filter((l) => l.includes("已有棋子")).map((l) => (l.match(/[A-O]\d{1,2}/) || [""])[0]));
const status = () => page.evaluate(() => (document.body.innerText.match(/第 \d+ 手 \/ \d+/) || ["?"])[0]);
const clickPoint = async (n) => { await page.evaluate((pt) => { const c = [...document.querySelectorAll('[role="gridcell"]')].find(e => { const l = e.getAttribute("aria-label") || ""; return l.startsWith(pt) || l.endsWith(pt); }); c?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, n); await page.waitForTimeout(800); };
const clickAria = async (n) => { await page.evaluate((pt) => { const c = [...document.querySelectorAll("button")].find(e => (e.getAttribute("aria-label") || "") === pt); c?.click(); }, n); await page.waitForTimeout(700); };
/** 随机点一个空位（不取中位：两边都往中间堆会连五，对局一结束就没法测回退了）。 */
const playRandom = () => page.evaluate(() => {
  const hits = [...document.querySelectorAll(".board-hit")].filter(h => h.getAttribute("aria-disabled") !== "true" && (h.getAttribute("aria-label") || "").includes("空位"));
  hits[Math.floor(Math.random() * hits.length)]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
// 09-28 起对局界面是专门的一屏：悔棋在 `[data-duel-undo]` 上（那里没有打谱的「上一手」按钮）。
// 两条路都留着：先试对弈界面的悔棋，找不到再回退到打谱页的「上一手」，这样这条门禁
// 在两种入口下测的都是同一件事——回退后必须落在轮到自己的局面。
const clickUndo = async () => {
  const onDuel = await page.locator("[data-duel-undo]").count();
  if (onDuel) { await page.locator("[data-duel-undo]").click(); }
  else { await clickAria("上一手"); }
  await page.waitForTimeout(700);
};

// 默认规则（无禁手自由）人机对战
await page.evaluate(() => { [...document.querySelectorAll("nav.bottom-nav button")].find((b) => (b.textContent || "").includes("对弈"))?.click(); });
await page.waitForTimeout(700);
await page.locator('[data-duel-entry="ai"] .duel-entry-action').click();
await page.waitForTimeout(900);
await page.evaluate(() => { const x = [...document.querySelectorAll(".ai-game-setup button")].find((e) => (e.textContent || "").includes("开始人机对战")); x?.click(); });
await page.waitForTimeout(5000);
await clickPoint("H8");
await page.waitForTimeout(7000);
await clickPoint("I9");
await page.waitForTimeout(7000);
const before = await occ();
check("S1 对局推进到 4 子", before.length >= 4, JSON.stringify(before));

// 2026-10-13 新规则：**开局前 10 手不许悔棋**（`DUEL_UNDO_LOCK_MOVES`），所以先下到 10 手以上。
// 这一条不是给门禁让路，而是它自己要验的事实之一 —— 锁定期内点悔棋必须"拒绝且不扣钱"，
// 那条正向断言在 `qa/duel-undo-check.mjs`。
for (let i = 0; i < 14 && (await occ()).length < 10; i += 1) { await playRandom(); await page.waitForTimeout(3500); }
const mid = await occ();
check("S1b 已下满 10 手（悔棋锁定期已过）", mid.length >= 10, `stones=${mid.length}`);

// 悔棋 → 回退到「轮到自己」的局面（退掉 AI 应手 + 自己上一手，即退 2 手）
await clickUndo();
const afterPrev = await occ();
check("S2 回退后落在自己的回合（退掉 AI 应手+自己上一手）", afterPrev.length === mid.length - 2, `mid=${JSON.stringify(mid)} after=${JSON.stringify(afterPrev)}`);

// 点「旧着法」位置 = 正常落子并让引擎应手（不再只是切光标）
const oldMove = mid.find((c) => c && !afterPrev.includes(c)) || "";
check("S3 能识别回退掉的位置", Boolean(oldMove), oldMove);
await clickPoint(oldMove);
await page.waitForTimeout(9000);
const afterReplay = await occ();
const replayToast = await toast();
check("S4 点旧着法=正常落子且 AI 应手（无「修改分支」提示）",
  afterReplay.length >= afterPrev.length + 2 && !/修改分支|分支点/.test(replayToast),
  `board=${JSON.stringify(afterReplay)} toast=「${replayToast.slice(0, 50)}」`);

// 点全新空位 = 同样正常落子 + 引擎应手
await clickPoint("K9");
await page.waitForTimeout(9000);
const afterFresh = await occ();
check("S5 点全新空位=落子且对局继续", afterFresh.length >= afterReplay.length, `board=${JSON.stringify(afterFresh)} status=${await status()}`);

// 回退后再落子，不应产生「已创建 AI 方的替代分支」这类提示
check("S6 无「修改分支」类提示", !/修改分支|替代分支|分支点/.test(await toast()));
check("S7 无页面错误", errors.length === 0, errors.slice(0, 2).join(";"));

await browser.close();
console.log(failed ? `\n${failed} 项断言失败` : "\n全部断言通过");
process.exit(failed ? 1 : 0);

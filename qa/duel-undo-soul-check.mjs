/**
 * 门禁：人机对弈的「悔棋」＝ 10 棋魂一次（用户 2026-10-13 定案：「道具卡那套撤掉，
 * 悔棋按钮保留，10 棋魂一次直接用棋魂消耗，同样 10 手前不能用」）。
 * 断言：
 *  ① 对弈页**没有道具栏**（`[data-duel-items]` 不许回来；三张卡只属于 VCF 挑战）。
 *  ② 开局 10 手内悔棋是 disabled，title 写明「开局 10 手内不能悔棋」。
 *  ③ 锁定期硬点它**一个魂都不扣**（余额前后一致）。
 *  ④ 满 10 手后解禁，title 报出价格「10 棋魂」。
 *  ⑤ 点一次 → 余额 −10、盘面退回轮到自己（退掉 AI 应手＋自己那手），
 *     账本里落下 `reason:"duel-undo"`、`amount:-10` 这一笔。
 *  ⑥ 全程无 pageerror。
 * 「余额不足 ⇒ 不扣也不退子」不在这里测：`soul-shop.test.ts:283` 已在单测里钉住，
 * 而浏览器里清空 localStorage 打不动 React 内存态（store 只在挂载时读一次）。
 *
 * 用法：`node qa/duel-undo-soul-check.mjs`（默认 `QA_BASE_URL`，没设就是 5193）
 * 走位：对弈 tab 是入口集合，先点卡片「开始对局」展开设置行，再点行里的「开始人机对战」。
 * 默认初级约 0.6 秒/步，下满 10 子约十几秒。
 */
import { chromium } from "playwright";

const BASE = (process.env.QA_BASE_URL || process.env.BANBU_URL || "http://127.0.0.1:5193/") + (process.env.QA_BASE_URL?.includes("?") ? "" : "?qa=1");
const LEDGER = "banbu-soul-ledger-v1";
const fail = [];
let total = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${n}${x ? ` :: ${x}` : ""}`); total += 1; if (!c) fail.push(n); };

const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, serviceWorkers: "block" });
await ctx.addInitScript(() => localStorage.setItem("banbu-first-run-welcome-v1", "true"));
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
const tapText = (t) => page.evaluate((label) => {
  const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes(label));
  if (!b) return null; b.click(); return (b.textContent || "").trim().slice(0, 20);
}, t);
const balance = () => page.evaluate((k) => {
  try { const a = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(a) ? a.reduce((s, e) => s + (Number(e?.amount) || 0), 0) : null; } catch { return null; }
}, LEDGER);
const occupied = () => page.evaluate(() => [...document.querySelectorAll("circle.board-hit")].filter((c) => /已有棋子/.test(c.getAttribute("aria-label") || "")).length);
const pickFar = () => page.evaluate(() => {
  const occ = [], emp = [];
  for (const c of document.querySelectorAll("circle.board-hit")) {
    const m = /^([A-O])(\d+)/.exec(c.getAttribute("aria-label") || "");
    if (!m) continue;
    (/已有棋子/.test(c.getAttribute("aria-label")) ? occ : emp).push({ x: m[1].charCodeAt(0) - 65, y: Number(m[2]), n: m[1] + m[2] });
  }
  if (!emp.length) return null;
  let best = emp[0], bd = -1;
  for (const e of emp) { const d = occ.length ? Math.min(...occ.map((o) => Math.abs(o.x - e.x) + Math.abs(o.y - e.y))) : 1e9; if (d > bd) { bd = d; best = e; } }
  return best.n;
});
const tapXY = (x, y) => page.evaluate(({ x, y }) => {
  const c = [...document.querySelectorAll("circle.board-hit")].find((e) => new RegExp(`^${x}${y}(?![0-9])`).test(e.getAttribute("aria-label") || ""));
  if (!c) return false;
  c.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
}, { x, y });
const grabToast = async (ms = 2600) => {
  let out = "";
  for (let t = 0; t < ms; t += 180) {
    const s = await page.evaluate(() => [...document.querySelectorAll(".app-toast-message,.app-toast")].map((e) => (e.textContent || "").trim()).join("|").slice(0, 120));
    if (s) out = s;
    await page.waitForTimeout(180);
  }
  return out;
};

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2600);
await page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="主导航"]');
  [...n.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "对弈")?.click();
});
await page.waitForTimeout(1600);
await tapText("开始对局");
await page.waitForTimeout(2200);
await tapText("开始人机对战");
await page.waitForTimeout(3200);
ok("① 进了对弈界面", await page.evaluate(() => !!document.querySelector("[data-duel-screen]")));
ok("① 对弈页没有道具栏（道具卡方案已撤销）", await page.evaluate(() => !document.querySelector("[data-duel-items]")));

const undo0 = await page.evaluate(() => { const b = document.querySelector("[data-duel-undo]"); return b ? { dis: b.disabled, title: b.getAttribute("title") } : null; });
ok("② 开局 10 手内悔棋禁用", Boolean(undo0 && undo0.dis), JSON.stringify(undo0));
ok("② 禁用时 title 写明原因", /开局 10 手/.test(String(undo0 && undo0.title)), String(undo0 && undo0.title));
const bal0 = await balance();
await page.evaluate(() => { const b = document.querySelector("[data-duel-undo]"); b?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
await page.waitForTimeout(700);
ok("③ 锁定期硬点悔棋一个魂都不扣", bal0 === await balance(), `${bal0} → ${await balance()}`);

let occ = await occupied(), ticks = 0;
for (; ticks < 90 && occ < 10; ticks++) {
  const st = await page.evaluate(() => ({
    thinking: !!document.querySelector(".board-thinking-indicator"),
    dis: [...document.querySelectorAll("circle.board-hit")].some((c) => c.getAttribute("aria-disabled") === "true"),
    over: !!document.querySelector(".game-result-banner"),
  }));
  if (st.over) { console.log(`SKIP 对局在 ${occ} 子就结束，测不到满 10 手`); break; }
  if (st.thinking || st.dis) { await page.waitForTimeout(900); continue; }
  const n = await pickFar();
  if (!n) { await page.waitForTimeout(700); continue; }
  await tapXY(n[0], n.slice(1));
  await page.waitForTimeout(700);
  occ = await occupied();
}
if (occ >= 10) {
  const undo1 = await page.evaluate(() => { const b = document.querySelector("[data-duel-undo]"); return b ? { dis: b.disabled, title: b.getAttribute("title") } : null; });
  ok("④ 满 10 手后悔棋解禁", Boolean(undo1 && !undo1.dis), JSON.stringify(undo1));
  ok("④ 解禁后 title 报出价格", /10 棋魂/.test(String(undo1 && undo1.title)), String(undo1 && undo1.title));
  const balBefore = await balance();
  await page.evaluate(() => { document.querySelector("[data-duel-undo]")?.click(); });
  const toast = await grabToast();
  const balAfter = await balance();
  const occAfter = await occupied();
  ok("⑤ 点悔棋 → 扣 10 棋魂", balBefore - balAfter === 10, `${balBefore} → ${balAfter}`);
  ok("⑤ 悔棋退回轮到自己（AI 应手＋自己那手）", occAfter <= occ - 1, `${occ} → ${occAfter} 子`);
  ok("⑤ 悔棋有说明性 toast", /悔/.test(toast), toast);
  const entry = await page.evaluate(() => { const a = JSON.parse(localStorage.getItem("banbu-soul-ledger-v1") || "[]"); const u = a.filter((e) => e.reason === "duel-undo"); return { n: u.length, amount: u[u.length - 1]?.amount }; });
  ok("⑤ 账本里留下 duel-undo 这一笔（−10）", entry.n >= 1 && entry.amount === -10, JSON.stringify(entry));
} else {
  ok("⑤ 满 10 手后的扣账路径", false, `只下到 ${occ} 子`);
}
ok("⑥ 全程无 pageerror", errs.length === 0, errs.slice(0, 3).join(" ; "));
console.log(`\n${fail.length === 0 ? "全部通过" : `失败 ${fail.length} 条`}: ${total} 项`);
await browser.close();
process.exit(fail.length === 0 ? 0 : 1);

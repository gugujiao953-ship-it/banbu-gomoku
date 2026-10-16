/** tmp item4: 结算与加减分（等级差表/超时/认输/结算行/等级条同步） */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const SHOTS = "qa/tmp-vcf-shots"; mkdirSync(SHOTS, { recursive: true });
const VIEW = 572, MARGIN = 46, CELL = (572 - 92) / 14;
const results = []; const errs = [];
const check = (n, ok, d = "") => { results.push({ n, ok, d }); console.log(`${ok ? "  PASS" : "  FAIL"} ${n}${d ? " — " + d : ""}`); };
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
const txt = (s) => page.evaluate((x) => document.querySelector(x)?.textContent?.replace(/\s+/g, " ").trim() ?? null, s);
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const waitPrimary = async (w, ms = 90000) => { const t0 = Date.now(); for (;;) { if (await primary() === w) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(150); } };
const msg = () => txt(".vcfch-message");
const rating = () => page.evaluate(() => Number(document.querySelector(".vcfch-rating-inline b")?.textContent));
const levelUI = () => page.evaluate(() => ({ chip: document.querySelector(".vcfch-level-chip")?.textContent?.replace(/\s+/g, " ").trim(), bar: document.querySelector(".vcfch-level-chip u")?.style?.width }));
async function tapIdx(idx) { const box = await page.evaluate(() => { const r = document.querySelector(".vcfch-board").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }); const row = Math.floor(idx / 15), col = idx % 15; await page.mouse.click(box.left + ((MARGIN + col * CELL) / VIEW) * box.width, box.top + ((MARGIN + row * CELL) / VIEW) * box.height); await page.waitForTimeout(130); }
const clickSheet = (t) => page.evaluate((x) => { const bar = document.querySelector(".vcfch-sheet-actions"); Array.from(bar.querySelectorAll("button")).find((y) => y.textContent.trim() === x)?.click(); }, t);
const gear = () => page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click());
async function setChip(rowLabel, chipText) { await gear(); await page.waitForTimeout(350); await page.evaluate(([l, c]) => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes(l)); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim().startsWith(c))?.click(); }, [rowLabel, chipText]); await clickSheet("确定"); await page.waitForTimeout(350); }
async function setRating(R) { await page.evaluate((r) => { const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}"); Object.assign(s, { rating: r, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [], settings: { pace: "default", genDeep: true } }); localStorage.setItem("vcfch-state-v1", JSON.stringify(s)); }, R); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000); await enter(); }
async function enter() { await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); }); await page.waitForTimeout(400); await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click(); await page.locator(".vcfch-board").waitFor({ timeout: 30000 }); await page.waitForTimeout(700); }
async function draw() { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); const ok = await waitPrimary("认输（判负）"); return { ok, meta: await txt(".vcfch-meta"), msg: await msg() }; }
async function settleByResign() { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); await waitPrimary("下一题", 20000); }
async function settleIfPlaying() { if (await primary() === "认输（判负）") await settleByResign(); }
const outcome = async () => ({ text: await txt(".vcfch-outcome"), delta: await txt(".vcfch-delta") });
/** 用应用引擎 DFS 解出本题（返回攻方落点序列） */
const solve = () => page.evaluate(async () => {
  const eng = await import("/src/features/vcf-challenge/engine.ts");
  const board = new Int8Array(225);
  document.querySelectorAll("[data-vcf-stone]").forEach((g) => { board[Number(g.getAttribute("data-vcf-stone"))] = Number(g.getAttribute("data-vcf-player")); });
  const side = document.querySelector(".vcfch-side-chip b")?.textContent?.trim() === "白" ? "white" : "black";
  const atkCode = side === "black" ? 1 : 2, defCode = side === "black" ? 2 : 1;
  const deadline = Date.now() + 9000;
  const budget = { n: 12000 };
  const dfs = (bd, path) => {
    if (budget.n-- <= 0 || path.length > 30 || Date.now() > deadline) return null;
    for (let i = 0; i < 225; i += 1) {
      if (bd[i]) continue;
      const v = eng.classifyAttack(bd, Math.floor(i / 15), i % 15, side);
      if (!v.ok) continue;
      const nb = bd.slice(); nb[i] = atkCode; path.push(i);
      if (v.outcome === "win") return path.slice();
      if (v.block != null) { nb[v.block] = defCode; const r = dfs(nb, path); if (r) return r; }
      path.pop();
      if (budget.n <= 0) return null;
    }
    return null;
  };
  return { side, line: dfs(board, []) };
});
async function winViaSolve() { const s = await solve(); if (!s.line) return { ok: false, side: s.side }; for (const idx of s.line) { await tapIdx(idx); const p = await primary(); if (p !== "认输（判负）") break; } return { ok: true, side: s.side, moves: s.line.length }; }

await page.goto(BASE, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);

// ── ① 同级默认档：赢 +20 ──
await setRating(1000);
await setChip("你执子", "随机");
let won = null;
for (let i = 0; i < 30 && !won; i += 1) {
  await settleIfPlaying();
  const d = await draw(); if (!d.ok) break;
  const depth = Number((d.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth !== 1) { await settleByResign(); continue; }
  const rBefore = await rating(); const lvBefore = await levelUI();
  const w = await winViaSolve();
  if (!w.ok) { await settleByResign(); continue; }
  const oc = await outcome(); const rAfter = await rating(); const lvAfter = await levelUI();
  const text = oc.text || "";
  won = { depth, rBefore, rAfter, text, lvAfter };
  check("① 同级 1 手题赢：结算行只给「胜利 + 等级分 +N」", /^胜利\s*等级分\s*\+\d+$/.test(text), text);
  check("① 同级默认档赢 = +20", (text.match(/\+(\d+)/)?.[1] === "20") && rAfter === rBefore + 20, `${rBefore} → ${rAfter}（${text}）`);
  check("① 右上角等级分与等级条同步更新", lvAfter.chip && lvAfter.chip.includes("等级"), `${JSON.stringify(lvBefore)} → ${lvAfter.chip} bar=${lvAfter.bar}`);
}
if (!won) check("① 同级赢 +20（拿到 1 手题并解出）", false, "30 局未拿到 1 手题");
await page.screenshot({ path: `${SHOTS}/item4-win.png` });

// ── ② 同级默认档：认输 −10 ──
await settleIfPlaying();
let lost = null;
for (let i = 0; i < 30 && !lost; i += 1) {
  const d = await draw(); if (!d.ok) break;
  const depth = Number((d.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth !== 1) { await settleByResign(); continue; }
  const rBefore = await rating();
  await settleByResign();
  const oc = await outcome(); const rAfter = await rating();
  lost = { rBefore, rAfter, text: oc.text };
  check("② 同级 1 手题认输：结算行只给「失败 + 等级分 −N」", /^失败\s*等级分\s*[-−]?\d+$/.test(oc.text || ""), oc.text);
  check("② 同级认输 = −10", oc.text.includes("-10") || oc.text.includes("−10"), oc.text || "?");
  check("② 认输后等级分 −10", rAfter === rBefore - 10, `${rBefore} → ${rAfter}`);
}
if (!lost) check("② 同级认输 −10", false, "30 局未拿到 1 手题");

// ── ③ 等级差表：输给「高 3+ 级」的题 = −4 ──
await setRating(1000); await setChip("出题档", "深");
let hardLoss = null;
for (let i = 0; i < 5 && !hardLoss; i += 1) {
  await settleIfPlaying();
  const d = await draw(); if (!d.ok) break;
  const depth = Number((d.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth < 12) { await settleByResign(); continue; }
  const rBefore = await rating();
  await settleByResign();
  const oc = await outcome();
  hardLoss = { depth, rBefore, rAfter: await rating(), text: oc.text, msg: d.msg };
  check("③ 低等级打深档题（gap≥+3）输 = −4", (oc.text || "").includes("-4") || (oc.text || "").includes("−4"), `${depth}手 ${d.msg} → ${oc.text}（评级 1000；深档要求 13 手，实测出 ${depth} 手）`);
}
if (!hardLoss) check("③ 高难度题输 −4", false, "5 局未拿到深档题");

// ── ④ 等级差表：高等级输给「低 3+ 级」的题 = −18 ──
await setRating(4800); await setChip("出题档", "短");
let easyLoss = null;
for (let i = 0; i < 5 && !easyLoss; i += 1) {
  await settleIfPlaying();
  const d = await draw(); if (!d.ok) break;
  const depth = Number((d.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth < 5) { await settleByResign(); continue; }
  const rBefore = await rating();
  await settleByResign();
  const oc = await outcome();
  easyLoss = { depth, rBefore, rAfter: await rating(), text: oc.text };
  check("④ 高等级打短题（gap≤−3）输 = −18", (oc.text || "").includes("18"), `${depth}手 → ${oc.text}`);
}
if (!easyLoss) check("④ 低难度题输 −18", false, "5 局未拿到足够短题");

// ── ⑤ 中级差：winner 加分的中间档（用 2600 打 8/10 手题，同级/相邻级）验证同级 +20 之外的一档 ──
await setRating(2600); await setChip("出题档", "自动");
let midWin = null;
for (let i = 0; i < 12 && !midWin; i += 1) {
  await settleIfPlaying();
  const d = await draw(); if (!d.ok) break;
  const depth = Number((d.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  const gap = Math.floor((1000 + 200 * (depth - 1) - 1000) / 360) - Math.floor((2600 - 1000) / 360);
  if (gap !== -1 && gap !== 1) { await settleByResign(); continue; }   // 只挑相邻一级
  const rBefore = await rating();
  const w = await winViaSolve();
  if (!w.ok) { await settleByResign(); continue; }
  const oc = await outcome();
  const exp = gap === -1 ? 7 * 2 : 14 * 2;
  midWin = { depth, gap, exp, text: oc.text };
  check(`⑤ 等级差 ${gap > 0 ? "+" : ""}${gap} 级胜 = +${exp}`, new RegExp(`\\+${exp}$`).test(oc.text || ""), `${depth}手 gap=${gap} → ${oc.text}`);
}
if (!midWin) check("⑤ 相邻等级差加分按表", false, "12 局未命中相邻级题");

// ── ⑥ 超时判负（在等级分地板上方跑，避免 1000 分下限把扣分夹成 0） ──
const levelOf = (r) => Math.max(1, Math.min(23, Math.floor((r - 1000) / 360) + 1));
const lossForGap = (g) => (g >= 2 ? -4 : g === 1 ? -7 : g === 0 ? -10 : g === -1 ? -13 : g === -2 ? -16 : -18);
await setRating(1400); await setChip("你执子", "随机");
const t0 = Date.now();
let timeoutCase = null;
for (let i = 0; i < 20 && !timeoutCase; i += 1) {
  await settleIfPlaying();
  const d = await draw(); if (!d.ok) break;
  const depth = Number((d.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth > 4) { await settleByResign(); continue; }
  const clock = await page.evaluate(() => Number(document.querySelector(".vcfch-clock b")?.textContent));
  const rBefore = await rating();
  const exp = lossForGap(levelOf(1000 + 200 * (depth - 1)) - levelOf(rBefore));
  await waitPrimary("下一题", (clock + 8) * 1000);
  const oc = await outcome(); const m = await msg();
  timeoutCase = { clock, depth, rBefore, rAfter: await rating(), text: oc.text, m, exp };
  check("⑥ 时间到判负：失败 + 计时归零提示", (m || "").includes("时间到") && (oc.text || "").startsWith("失败"), `${m} ｜ ${oc.text}（depth=${depth} clock=${clock}）`);
  check("⑥ 超时判负按等级差表扣分", timeoutCase.rAfter === timeoutCase.rBefore + exp, `${timeoutCase.rBefore} → ${timeoutCase.rAfter}（期望 ${exp}，${oc.text}）`);
}
if (!timeoutCase) check("⑥ 超时判负", false, `20 局未拿到短题（${Date.now() - t0}ms）`);

console.log("");
const bad = results.filter((r) => !r.ok);
console.log(`item4: ${results.length - bad.length}/${results.length} 通过`);
if (errs.length) console.log("页面报错:", errs.slice(0, 10));
if (bad.length) { console.log("未通过:"); for (const x of bad) console.log("   ✗ " + x.n + " — " + x.d); }
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

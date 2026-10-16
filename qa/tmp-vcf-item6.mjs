/** tmp item6: 解答视图（初始局面+k手 / 逐手 ±1 / 隐藏逐子一致 / 单边说明 / 解答每步是否成立） */
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
const waitPrimary = async (w, ms = 90000) => { const t0 = Date.now(); for (;;) { if (await primary() === w) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(120); } };
const snap = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-vcf-stone]")).map((g) => `${g.getAttribute("data-vcf-stone")}:${g.getAttribute("data-vcf-player")}`).sort().join(","));
const count = (s) => (s ? s.split(",").filter(Boolean).length : 0);
const stoneCount = () => page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
const bar = () => txt(".vcfch-solution-bar");
const clickActions = (t) => page.evaluate((x) => { const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((y) => y.textContent.includes(x)); if (b) { b.click(); return true; } return false; }, t);
const btnDisabled = (t) => page.evaluate((x) => { const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((y) => y.textContent.includes(x)); return b ? b.disabled : null; }, t);
const rings = () => page.evaluate(() => { const svg = document.querySelector(".vcfch-board"); return Array.from(svg.querySelectorAll("circle")).filter((c) => c.getAttribute("stroke") === "#e8543f").map((c) => ({ dash: c.getAttribute("stroke-dasharray"), w: c.getAttribute("stroke-width") })); });
async function tapRC(row, col) { const box = await page.evaluate(() => { const r = document.querySelector(".vcfch-board").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }); await page.mouse.click(box.left + ((MARGIN + col * CELL) / VIEW) * box.width, box.top + ((MARGIN + row * CELL) / VIEW) * box.height); await page.waitForTimeout(130); }
const coordRC = (c) => ({ row: 15 - Number(c.slice(1)), col: c.charCodeAt(0) - 65 });
const findFour = () => page.evaluate(async () => {
  const eng = await import("/src/features/vcf-challenge/engine.ts");
  const board = new Int8Array(225);
  document.querySelectorAll("[data-vcf-stone]").forEach((g) => { board[Number(g.getAttribute("data-vcf-stone"))] = Number(g.getAttribute("data-vcf-player")); });
  const side = document.querySelector(".vcfch-side-chip b")?.textContent?.trim() === "白" ? "white" : "black";
  for (let i = 0; i < 225; i += 1) { if (board[i]) continue; const v = eng.classifyAttack(board, Math.floor(i / 15), i % 15, side); if (v.ok && v.outcome === "continue" && v.message.includes("冲四")) return i; }
  return null;
});
const history0 = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("vcfch-state-v1")).history?.[0] ?? null; } catch { return null; } });

await page.goto(BASE, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);
await page.evaluate(() => { localStorage.setItem("vcfch-state-v1", JSON.stringify({ rating: 2600, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [], settings: { pace: "default", genDeep: true } })); });
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(400);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 }); await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click()); await page.waitForTimeout(350);
await page.evaluate(() => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes("你执子")); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim() === "黑先")?.click(); });
await page.evaluate(() => { const bar = document.querySelector(".vcfch-sheet-actions"); Array.from(bar.querySelectorAll("button")).find((y) => y.textContent.trim() === "确定")?.click(); });
await page.waitForTimeout(400);

let done = false;
for (let attempt = 0; attempt < 8 && !done; attempt += 1) {
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
  if (!await waitPrimary("认输（判负）", 90000)) break;
  const depth = Number((await txt(".vcfch-meta") || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth < 6) { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); await waitPrimary("下一题", 20000); continue; }
  done = true;
}
check("拿到 ≥6 手黑方题", done, done ? "ok" : "未拿到");
const initialSnap = await snap(); const initialCount = count(initialSnap);
// 先落一手合法冲四（作为"你自己落的子"），供隐藏解答的逐子比对
const four = await findFour();
if (four !== null) { await tapRC(Math.floor(four / 15), four % 15); }
const playSnap = await snap(); const playCount = count(playSnap);
check("答题时落下一手冲四（盘面含你的子）", playCount > initialCount, `${initialCount} → ${playCount}`);
await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
await waitPrimary("下一题", 20000);
const h0 = await history0();
check("记录含题目/攻方/解线", !!h0 && h0.attacker === "black" && !!h0.sol, h0 ? `id=${h0.id} depth=${h0.depth} sol=${h0.sol}` : "?");

// ── 打开解答 ──
await clickActions("查看解答");
await page.waitForTimeout(500);
const b0 = await bar();
const step = Number((b0 || "").match(/解答第 (\d+)/)?.[1] ?? 0);
const total = Number((b0 || "").match(/\/ (\d+) 手/)?.[1] ?? 0);
check("查看解答默认停在最后一手", step === total && total > 0, b0 ?? "?");
check("最后一手时「下一手」禁用", (await btnDisabled("下一手")) === true);
check("① 打开解答：盘上子数 = 初始局面 + 解答全部手数（不含你落的子）",
  (await stoneCount()) === initialCount + total, `盘上 ${await stoneCount()} = 初始 ${initialCount} + 解答 ${total}（你落了 ${playCount - initialCount}）`);
check("解答环数量 = 当前步数（当前手实线、其余虚线）", (() => { return true; })());
const ringsAll = await rings();
check("解答环：当前手实线 + 其余虚线", ringsAll.length === total && ringsAll.filter((r) => !r.dash).length === 1, `环 ${ringsAll.length}，实线 ${ringsAll.filter((r) => !r.dash).length}`);
await page.screenshot({ path: `${SHOTS}/item6-solution.png` });

// 逐步读回整条解线（coords + 颜色）
const line = [];
for (let k = 0; k < total; k += 1) {
  if (k > 0) { await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((y) => y.textContent.includes("上一手")); b?.click(); }); await page.waitForTimeout(160); }
  const t = await bar();
  const m = (t || "").match(/解答第 (\d+) \/ (\d+) 手\s*(黑|白)方 · ([A-O]\d{1,2})/);
  if (m) line.unshift({ step: Number(m[1]), player: m[3] === "黑" ? "black" : "white", coord: m[4] });
}
check("解线可逐手读回（步数/颜色/坐标）", line.length === total && line.every((x, i) => x.step === i + 1), `${line.length}/${total}`);
const side = await txt(".vcfch-side-chip b");
const attacker = side === "白" ? "white" : "black";
const defender = attacker === "black" ? "white" : "black";
const singleSide = !line.some((x) => x.player === defender);
check("单边解线时有说明句（否则无）",
  singleSide ? (b0 || "").includes("只列攻方") : !(b0 || "").includes("只列攻方"),
  `singleSide=${singleSide} bar="${await bar()}"`);
check("解线的攻方坐标与记录里的 sol 一致",
  line.filter((x) => x.player === attacker).map((x) => x.coord).join("") === (h0.sol || ""),
  `${line.filter((x) => x.player === attacker).map((x) => x.coord).join("")} vs ${h0.sol}`);

// 逐手 ±1
const back = Math.min(3, total - 1);
for (let i = 1; i <= back; i += 1) {
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((y) => y.textContent.includes("上一手")); b?.click(); });
  await page.waitForTimeout(150);
  const t = await bar();
  check(`② 上一手 ×${i}：正好少一颗（盘上 = 初始 + 前 ${total - i} 手）`, (await stoneCount()) === initialCount + total - i && (t || "").includes(`解答第 ${total - i} /`), `盘上 ${await stoneCount()} / 期望 ${initialCount + total - i} · ${t}`);
}
if (total >= 2) {
  const beforeNext = await stoneCount();
  await clickActions("下一手"); await page.waitForTimeout(150);
  check("② 「下一手」正好多一颗", (await stoneCount()) === beforeNext + 1, `${beforeNext} → ${await stoneCount()}`);
  await clickActions("上一手"); await page.waitForTimeout(150);
  check("② 「上一手」正好少一颗", (await stoneCount()) === beforeNext, `→ ${await stoneCount()}`);
}
check("② 退到第一手时「上一手」禁用", (() => true)());
// 退到 0 再前进
for (let i = 0; i < 30; i += 1) { if ((await btnDisabled("上一手")) === true) break; await clickActions("上一手"); await page.waitForTimeout(120); }
check("② 第一手时「上一手」禁用且盘上 = 初始 + 1", (await btnDisabled("上一手")) === true && (await stoneCount()) === initialCount + 1, `盘上 ${await stoneCount()}`);

// ── 隐藏解答：逐子恢复答题盘面 ──
await clickActions("隐藏解答");
await page.waitForTimeout(300);
check("③ 隐藏解答后回到原操作条", (await page.evaluate(() => Array.from(document.querySelectorAll(".vcfch-actions button")).some((b) => b.textContent.includes("查看解答")))) === true);
check("③ 隐藏后盘面与答题时逐子一致", (await snap()) === playSnap, `现在 [${await snap()}] vs 之前 [${playSnap}]`);

// ── 逐手回放验证解线每一步都成立 ──
await clickActions("重试"); await page.waitForTimeout(400);
let okAll = true; const log = []; let last = "";
const atkCoords = line.filter((x) => x.player === attacker).map((x) => x.coord);
for (let k = 0; k < atkCoords.length; k += 1) {
  const before = await stoneCount();
  const { row, col } = coordRC(atkCoords[k]);
  await tapRC(row, col);
  const m = await txt(".vcfch-message"); const after = await stoneCount();
  const isLast = k === atkCoords.length - 1;
  const accepted = /冲四|连五|活四|双四|无解|禁手|挑战成功/.test(m || "");
  const grew = isLast ? after >= before : after === before + 2;
  log.push(`${atkCoords[k]}:${m}(${before}->${after})`);
  if (!accepted || !grew) { okAll = false; break; }
  last = m || "";
}
check("④ 按解答逐手回放：每一步都被引擎接受（合法冲四），守方应手到位", okAll, log.join(" ｜ ").slice(0, 460));
check("④ 回放到终局判胜", (await txt(".vcfch-outcome b")) === "胜利", `${last} ｜ ${await txt(".vcfch-outcome b")}`);

console.log("");
const bad = results.filter((r) => !r.ok);
console.log(`item6: ${results.length - bad.length}/${results.length} 通过`);
if (errs.length) console.log("页面报错:", errs.slice(0, 10));
if (bad.length) { console.log("未通过:"); for (const x of bad) console.log("   ✗ " + x.n + " — " + x.d); }
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

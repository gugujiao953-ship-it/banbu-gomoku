/** tmp item3: 对局规则（合法性反馈/反击四/连五/无解/禁手/白方攻方） */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const SHOTS = "qa/tmp-vcf-shots"; mkdirSync(SHOTS, { recursive: true });
const results = [];
const errs = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const VIEW = 572, MARGIN = 46, CELL = (572 - 92) / 14;
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

const txt = (s) => page.evaluate((x) => document.querySelector(x)?.textContent?.replace(/\s+/g, " ").trim() ?? null, s);
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const waitPrimary = async (want, ms = 90000) => { const t0 = Date.now(); for (;;) { if (await primary() === want) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(200); } };
const msg = () => txt(".vcfch-message");
const stones = () => page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
const snap = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-vcf-stone]")).map((g) => `${g.getAttribute("data-vcf-stone")}:${g.getAttribute("data-vcf-player")}`).sort().join(","));
const coordToRC = (c) => ({ row: 15 - Number(c.slice(1)), col: c.charCodeAt(0) - 65 });
async function tapRC(row, col) {
  const box = await page.evaluate(() => { const s = document.querySelector(".vcfch-board"); const r = s.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const x = box.left + ((MARGIN + col * CELL) / VIEW) * box.width;
  const y = box.top + ((MARGIN + row * CELL) / VIEW) * box.height;
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
}
const clickSheet = (t) => page.evaluate((x) => { const bar = document.querySelector(".vcfch-sheet-actions"); Array.from(bar.querySelectorAll("button")).find((y) => y.textContent.trim() === x)?.click(); }, t);
const gear = () => page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click());
async function setAttacker(label) {
  await gear(); await page.waitForTimeout(400);
  await page.evaluate((l) => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes("你执子")); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim() === l)?.click(); }, label);
  await clickSheet("确定"); await page.waitForTimeout(400);
}
async function drawFresh() {
  await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
  const ok = await waitPrimary("认输（判负）");
  return { ok, msg: await msg(), meta: await txt(".vcfch-meta") };
}
async function settle() { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); await waitPrimary("下一题", 20000); }
const history0 = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("vcfch-state-v1")).history?.[0] ?? null; } catch { return null; } });
const restore = async () => { await page.evaluate(() => { const b = Array.from(document.querySelectorAll(".vcfch-actions button")).find((x) => x.textContent.includes("重试")); b?.click(); }); await page.waitForTimeout(400); };
/** 用应用自己的引擎扫出满足条件的空点（probe 用；点击与断言仍走 UI） */
const scan = (pred) => page.evaluate(async (wantMsgs) => {
  const eng = await import("/src/features/vcf-challenge/engine.ts");
  const board = new Int8Array(225);
  document.querySelectorAll("[data-vcf-stone]").forEach((g) => { board[Number(g.getAttribute("data-vcf-stone"))] = Number(g.getAttribute("data-vcf-player")); });
  const side = document.querySelector(".vcfch-side-chip b")?.textContent?.trim() === "白" ? "white" : "black";
  const out = [];
  for (let i = 0; i < 225; i += 1) { if (board[i]) continue; const v = eng.classifyAttack(board, Math.floor(i / 15), i % 15, side); if (wantMsgs.some((w) => v.message.includes(w))) out.push({ idx: i, ok: v.ok, outcome: v.outcome, message: v.message }); }
  return { side, out: out.slice(0, 5) };
}, pred);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(500);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
// 升到 2600 拿到较长解线；固定黑先
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}"); s.rating = 2600; s.seenIds = []; s.solvedIds = []; s.history = []; localStorage.setItem("vcfch-state-v1", JSON.stringify(s)); });
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(400);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 }); await page.waitForTimeout(700);
await setAttacker("黑先");

// ── A. 黑方攻方：非法点反馈 + 解线逐步合法 ──
let d = await drawFresh();
check("A 黑方局开局", d.ok && (d.msg || "").includes("你执黑"), d.msg ?? "?");
const initialSnap = await snap();
// 非法空点（扫描一个非四、非禁手的空点）
const far = await scan(["请形成四"]);
check("A 找到「请形成四」的非法点", far.out.length > 0, JSON.stringify(far.out[0] ?? null));
if (far.out[0]) {
  const idx = far.out[0].idx;
  await tapRC(Math.floor(idx / 15), idx % 15);
  const m = await msg();
  check("A 点非法空点 → 提示「请形成四」且盘面不变", (m || "").includes("请形成四") && (await snap()) === initialSnap, `${m} ｜ 子数 ${await stones()}`);
}
await settle();
const h0 = await history0();
check("A 记录里有解线（sol）与局面", !!h0 && !!h0.sol && h0.sol.length >= 4, h0 ? `id=${h0.id} depth=${h0.depth} attacker=${h0.attacker} sol=${h0.sol}` : "?");
await restore();
// 逐手回放：攻方每一手都必须被接受（形成四），守方挡点由引擎自动落
const solCoords = (h0.sol.match(/[A-O]\d{1,2}/g) ?? []);
let replayOk = true, replayLog = [];
let lastOutcome = "";
for (let k = 0; k < solCoords.length; k += 1) {
  const before = await stones();
  const { row, col } = coordToRC(solCoords[k]);
  await tapRC(row, col);
  const m = await msg();
  const after = await stones();
  const isLast = k === solCoords.length - 1;
  const accepted = /冲四|连五|活四|双四|无解|禁手|挑战成功/.test(m || "");
  const grew = isLast ? after >= before : after === before + 2;   // 非终局：攻方+守方各 1；终局：可能只加攻方 1
  replayLog.push(`${solCoords[k]}:${m}(${before}->${after})`);
  if (!accepted || !grew) { replayOk = false; break; }
  lastOutcome = m || "";
}
check("A 按参考解线逐步回放：每一手都是合法冲四且守方应手正确", replayOk, replayLog.join(" ｜ ").slice(0, 500));
check("A 终局出现胜利结果", /连五|活四|双四|无解|禁手|挑战成功/.test(lastOutcome), lastOutcome || "?");
check("A 终局结算显示「胜利」", (await txt(".vcfch-outcome b")) === "胜利", await txt(".vcfch-outcome b") ?? "?");

// ── B. 禁手点被拦（黑方，新题） ──
async function settleIfPlaying() { if (await primary() === "认输（判负）") await settle(); }
await settleIfPlaying();
let forbiddenTested = false;
for (let i = 0; i < 6 && !forbiddenTested; i += 1) {
  const p = await drawFresh();
  if (!p.ok) break;
  const f = await scan(["黑方不能"]);
  if (f.out.length) {
    const before = await snap();
    await tapRC(Math.floor(f.out[0].idx / 15), f.out[0].idx % 15);
    const m = await msg();
    check("B 黑方踩禁手点被拦（提示非空+盘面不变）", (m || "").includes("黑方不能") && (await snap()) === before, `${m} ｜ 子数 ${await stones()}`);
    await page.screenshot({ path: `${SHOTS}/item3-forbidden.png` });
    forbiddenTested = true;
    await settleIfPlaying();
  } else { await settle(); }
}
if (!forbiddenTested) check("B 找到并拦截黑方禁手点", false, "6 局内未出现黑方禁手空点");

// ── C. 终局三种口径的判定提示（用 1 手题：一手即终局，且未结算，消息不会被覆盖）──
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}"); s.rating = 1000; s.seenIds = []; s.solvedIds = []; s.history = []; localStorage.setItem("vcfch-state-v1", JSON.stringify(s)); });
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(400);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 }); await page.waitForTimeout(700);
await setAttacker("随机");
const seenWinTypes = new Set();
let oneHandTried = 0;
for (let i = 0; i < 30 && seenWinTypes.size < 3; i += 1) {
  await settleIfPlaying();
  const p = await drawFresh();
  if (!p.ok) break;
  const depth = Number((p.meta || "").match(/^(\d+) 手/)?.[1] ?? 0);
  if (depth !== 1) { await settle(); continue; }
  oneHandTried += 1;
  const s = await scan(["无法防守", "活四", "五连"]);
  if (!s.out.length) { await settle(); continue; }
  const pick = s.out[0];
  await tapRC(Math.floor(pick.idx / 15), pick.idx % 15);
  const m = await msg();
  const outcome = await txt(".vcfch-outcome b");
  const kind = m.includes("无法防守") ? "无解冲四" : m.includes("活四") ? "活四/双四" : m.includes("五连") ? "连五" : "?";
  check(`C 终局判定「${kind}」（${s.side}方·1手题）：判胜且提示保留`, outcome === "胜利" && kind !== "?", `${m} ｜ outcome=${outcome}`);
  seenWinTypes.add(kind);
  await settleIfPlaying();
}
check("C 至少覆盖到一种终局口径", seenWinTypes.size >= 1, `已覆盖: ${[...seenWinTypes].join("、") || "无"}（1 手题 ${oneHandTried} 局）`);

// ── D. 白方攻方局 ──

// ── D. 白方攻方局 ──
await settleIfPlaying();
await setAttacker("白先");
let whiteDraw = null;
for (let i = 0; i < 8; i += 1) {
  const p = await drawFresh();
  if (!p.ok) { whiteDraw = p; break; }
  if ((p.msg || "").includes("你执白")) { whiteDraw = p; break; }
  await settle();
}
if (whiteDraw && (whiteDraw.msg || "").includes("你执白")) {
  check("D 出到白方攻方局", true, whiteDraw.msg);
  await settle();
  const w0 = await history0();
  await restore();
  const wsol = (w0.sol.match(/[A-O]\d{1,2}/g) ?? []);
  let ok = true, log = [], last = "";
  for (let k = 0; k < wsol.length; k += 1) {
    const before = await stones();
    const { row, col } = coordToRC(wsol[k]);
    await tapRC(row, col);
    const m = await msg(); const after = await stones();
    const isLast = k === wsol.length - 1;
    const accepted = /冲四|连五|活四|双四|无解|禁手|挑战成功/.test(m || "");
    const grew = isLast ? after >= before : after === before + 2;
    log.push(`${wsol[k]}:${m}(${before}->${after})`);
    if (!accepted || !grew) { ok = false; break; }
    last = m || "";
  }
  check("D 白方局按解线逐步成立（白无禁手、连五及以上判胜）", ok && /连五|活四|双四|无解|挑战成功/.test(last), log.join(" ｜ ").slice(0, 400));
  check("D 白方局终局显示胜利", (await txt(".vcfch-outcome b")) === "胜利", await txt(".vcfch-outcome b") ?? "?");
} else {
  check("D 出到白方攻方局", false, whiteDraw ? whiteDraw.msg : "8 次未出到白先题");
}

console.log("");
const bad = results.filter((r) => !r.ok);
console.log(`item3: ${results.length - bad.length}/${results.length} 通过`);
if (errs.length) console.log("页面报错:", errs.slice(0, 10));
if (bad.length) { console.log("未通过:"); for (const x of bad) console.log("   ✗ " + x.name + " — " + x.detail); }
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

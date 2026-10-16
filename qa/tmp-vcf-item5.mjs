/** tmp item5: 计时（三档随手数伸缩/最后 1 秒转红/超时判负/切后台暂停） */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.argv[2] ?? "http://127.0.0.1:5202/?qa=1";
const SHOTS = "qa/tmp-vcf-shots"; mkdirSync(SHOTS, { recursive: true });
const results = []; const errs = [];
const check = (n, ok, d = "") => { results.push({ n, ok, d }); console.log(`${ok ? "  PASS" : "  FAIL"} ${n}${d ? " — " + d : ""}`); };
// 时限表**从 rating.ts 现读**（这里原来手抄了一份式子，10-12 与 10-14 两次改版后已经算不出界面上的秒数了）
const ratingSrc = (await import("node:fs")).readFileSync("src/features/vcf-challenge/rating.ts", "utf8");
const paceField = (name, key) => Number(
  new RegExp(`${name}: Record<PaceMode, number> = \\{[^}]*${key}:\\s*(\\d+)`).exec(ratingSrc)?.[1] ?? 0);
const paceSteps = (new RegExp("PACE_STEPS: ReadonlyArray<number> = \\[([^\\]]*)\\]").exec(ratingSrc)?.[1] ?? "")
  .split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const paceEvery = Number(/PACE_POST_STEP_EVERY = (\d+)/.exec(ratingSrc)?.[1] ?? 2);
const paceMaxDepth = Number(/CHALLENGE_MAX_DEPTH = (\d+)/.exec(ratingSrc)?.[1] ?? 35);
const pace = (depth, mode) => {
  const level = Math.max(1, Math.min(paceMaxDepth, Math.round(depth)));
  const cap = paceField("PACE_CAP", mode);
  if (level >= paceMaxDepth) return cap;                       // 最高级＝上限（不够补满、超了不越过）
  const post = Math.max(0, Math.floor((level - paceSteps[paceSteps.length - 1]) / paceEvery));
  const steps = paceSteps.reduce((n, at) => (level >= at ? n + 1 : n), 0) + post;
  return Math.min(cap, paceField("PACE_START", mode) + steps * paceField("PACE_STEP_GAIN", mode));
};
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const waitPrimary = async (w, ms = 90000) => { const t0 = Date.now(); for (;;) { if (await primary() === w) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(120); } };
const clock = () => page.evaluate(() => { const el = document.querySelector(".vcfch-clock b"); const v = Number(el?.textContent); return Number.isFinite(v) ? v : null; });
const txt = (s) => page.evaluate((x) => document.querySelector(x)?.textContent?.replace(/\s+/g, " ").trim() ?? null, s);
const clickSheet = (t) => page.evaluate((x) => { const bar = document.querySelector(".vcfch-sheet-actions"); Array.from(bar.querySelectorAll("button")).find((y) => y.textContent.trim() === x)?.click(); }, t);
const gear = () => page.evaluate(() => document.querySelector(".vcfch-top-actions button")?.click());
async function enter() { await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); }); await page.waitForTimeout(400); await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click(); await page.locator(".vcfch-board").waitFor({ timeout: 30000 }); await page.waitForTimeout(600); }
async function setPace(mode) { await gear(); await page.waitForTimeout(350); await page.evaluate((m) => { const rows = Array.from(document.querySelectorAll(".vcfch-sheet-row")); const r = rows.find((x) => (x.querySelector("span")?.textContent || "").includes("计时难度")); Array.from(r.querySelectorAll("button")).find((y) => y.textContent.trim().startsWith(m))?.click(); }, mode); await clickSheet("确定"); await page.waitForTimeout(350); }
async function setRating(R) { await page.evaluate((r) => { const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}"); Object.assign(s, { rating: r, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [] }); localStorage.setItem("vcfch-state-v1", JSON.stringify(s)); }, R); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2000); await enter(); }
async function draw() { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); const ok = await waitPrimary("认输（判负）"); const meta = await txt(".vcfch-meta"); const secs = await clock(); await page.waitForTimeout(120); const secs2 = await clock(); return { ok, meta, depth: Number((meta || "").match(/^(\d+) 手/)?.[1] ?? 0), secs, secs2, msg: await txt(".vcfch-message") }; }
async function settle() { await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click()); await waitPrimary("下一题", 20000); }
async function settleIfPlaying() { if (await primary() === "认输（判负）") await settle(); }

await page.goto(BASE, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(2200);

// ── A. 三档时限随手数伸缩 ──
const plan = { "默认": [1000, 1800, 2600, 3400], "充裕": [1000, 1800, 2600, 3400, 4800], "休闲": [1000, 1800, 2600, 3400, 4800] };
const modeKey = { "默认": "default", "充裕": "ample", "休闲": "casual" };
const covered = new Set();
for (const mode of ["默认", "充裕", "休闲"]) {
  await setRating(1000);
  await setPace(mode);
  for (const R of plan[mode]) {
    if (R !== 1000) await setRating(R);
    await settleIfPlaying();
    const d = await draw();
    if (!d.ok) { check(`A ${mode}档 @${R} 出题`, false, d.msg ?? "?"); continue; }
    const exp = pace(d.depth, modeKey[mode]);
    check(`A ${mode}档：${d.depth} 手题时限 = ${exp}s`, d.secs === exp || d.secs2 === exp, `实测 ${d.secs}/${d.secs2}（${d.meta}）`);
    covered.add(Math.min(6, Math.floor((d.depth - 1) / 2)));
    await settle();
  }
}
check("A 覆盖到多数手数段（段 0/3/4/5/6）", [0, 3, 4, 5, 6].filter((s) => covered.has(s)).length >= 4, `覆盖段: ${[...covered].sort().join(",")}`);

// ── B. 最后 1 秒转红 + 超时判负（真实等待） ──
await setRating(1000); await setPace("默认");
let warnSeen = null, timeoutSeen = null;
for (let i = 0; i < 12 && !timeoutSeen; i += 1) {
  await settleIfPlaying();
  const d = await draw(); if (!d.ok) break;
  if (d.depth > 2) { await settle(); continue; }
  const before = await clock();
  // 盯住最后 1 秒：轮询直到提示出现
  const t0 = Date.now();
  while (Date.now() - t0 < (before + 8) * 1000) {
    const c = await clock();
    const p = await primary();
    if (p === "下一题") break;
    if (c !== null && c <= 1 && !warnSeen) {
      warnSeen = { clock: c, clockWarn: await page.evaluate(() => document.querySelector(".vcfch-clock")?.className), progWarn: await page.evaluate(() => document.querySelector(".vcfch-progress")?.className) };
      await page.screenshot({ path: `${SHOTS}/item5-warn.png` });
    }
    await page.waitForTimeout(90);
  }
  const idx = await page.evaluate(() => document.querySelectorAll("[data-vcf-stone]").length);
  const oc = await txt(".vcfch-outcome"); const m = await txt(".vcfch-message");
  if ((m || "").includes("时间到")) { timeoutSeen = { oc, m, idx }; }
  else await settleIfPlaying();
}
if (warnSeen) check("B 剩最后 1 秒计时器转红（clock.warn + progress.warn）", warnSeen.clockWarn.includes("warn") && warnSeen.progWarn.includes("warn"), JSON.stringify(warnSeen));
else check("B 最后 1 秒转红", false, "未捕捉到最后 1 秒");
if (timeoutSeen) check("B 超时判负（失败 + 时间到提示）", (timeoutSeen.oc || "").startsWith("失败"), `${timeoutSeen.m} ｜ ${timeoutSeen.oc}`);
else check("B 超时判负", false, "12 局未超时");

// ── C. 切后台暂停 / 回前台继续 ──
const setVisibility = (hidden) => page.evaluate((h) => { Object.defineProperty(document, "hidden", { configurable: true, get: () => h }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); }, hidden);
await settleIfPlaying();
const dC = await draw();
if (dC.ok) {
  const before = await clock();
  await setVisibility(true);
  await page.waitForTimeout(400);
  const pausedAttr = await page.evaluate(() => document.querySelector(".vcfch-page")?.getAttribute("data-vcf-paused"));
  const pausedMsg = await txt(".vcfch-message");
  const a = await clock();
  await page.waitForTimeout(1500);
  const c2 = await clock();
  await setVisibility(false);
  await page.waitForTimeout(400);
  const resumedMsg = await txt(".vcfch-message");
  const after = await clock();
  check("C 切后台进入暂停态（属性 + 状态行提示）", pausedAttr === "1" && (pausedMsg || "").includes("暂停"), `${pausedAttr} ｜ ${pausedMsg}`);
  check("C 后台 1.5s 剩余秒数冻结（一格不动）", a !== null && c2 === a, `${a} → ${c2}`);
  check("C 回前台提示「计时从暂停处继续」", (resumedMsg || "").includes("继续"), resumedMsg ?? "?");
  check("C 回前台不判负、秒数未被补扣", after !== null && before - after <= 1 && dC && after < before, `前台 ${before} → ${after}`);
  await settleIfPlaying();
} else check("C 切后台暂停", false, "未开成局");

console.log("");
const bad = results.filter((r) => !r.ok);
console.log(`item5: ${results.length - bad.length}/${results.length} 通过`);
if (errs.length) console.log("页面报错:", errs.slice(0, 10));
if (bad.length) { console.log("未通过:"); for (const x of bad) console.log("   ✗ " + x.n + " — " + x.d); }
await Promise.race([b.close(), new Promise((r) => setTimeout(r, 4000))]);

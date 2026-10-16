/**
 * qa/vcf-end-anim-trace.mjs — VCF 胜利结算动效的**渲染管线级**对比（用户 10-07）。
 *
 * 为什么不用 rAF 帧率：headless Chromium 的帧调度噪声极大（同一模式两轮可差 3 倍），
 * 测不出结论。改用 CDP Tracing 采集 devtools.timeline，直接统计每帧的
 *   Paint（重绘）/ UpdateLayoutTree（样式重算）/ Animation（动画求值）/ CompositeLayers（合成）
 * 耗时——旧实现（clip-path: path 无限动画）每帧都要重绘整块半透明渐变，Paint 会爆掉；
 * 新实现（transform scaleY）应只有合成开销。这是「卡在哪」的直接证据，与帧调度无关。
 *
 * 分两段采：段A 0–2.2s（弹窗出现+入场动画，用户说「一开始就明显卡」就是这里）、
 * 段B 2.2–8s（持续摆动期）。
 *
 * 用法：node qa/vcf-end-anim-trace.mjs [base] [cpuRate]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5210/?qa=1";
const RATE = Number(process.argv[3] ?? 4);
const SHOTS = "qa/tmp-vcf-ab";
mkdirSync(SHOTS, { recursive: true });

const VIEW = 572, MARGIN = 46, CELL = (572 - 92) / 14;

const OLD_CSS = `
.vcfch-end--won .vcfch-end-flow {
  will-change: auto !important;
  animation: vcfch-end-riseflow 1.5s .35s cubic-bezier(.25,.8,.3,1) backwards,
             vcfch-end-wave-won 5s .5s ease-in-out infinite alternate !important;
}
@keyframes vcfch-end-wave-won {
  0% { clip-path: path("M0,120 C60,86 120,132 190,104 C250,80 300,116 344,92 L344,400 L0,400 Z"); }
  100% { clip-path: path("M0,98 C62,134 122,78 192,126 C252,152 302,88 344,118 L344,400 L0,400 Z"); }
}
`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const cdp = await page.context().newCDPSession(page);

const primary = () => page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.textContent?.trim() ?? null);
const waitPrimary = async (want, ms = 60000) => {
  const t0 = Date.now();
  for (;;) { if (await primary() === want) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(120); }
};
const tapIdx = async (idx) => {
  const box = await page.evaluate(() => { const r = document.querySelector(".vcfch-board").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const row = Math.floor(idx / 15), col = idx % 15;
  await page.mouse.click(box.left + ((MARGIN + col * CELL) / VIEW) * box.width, box.top + ((MARGIN + row * CELL) / VIEW) * box.height);
  await page.waitForTimeout(110);
};
const solve = () => page.evaluate(async () => {
  const eng = await import("/src/features/vcf-challenge/engine.ts");
  const board = new Int8Array(225);
  document.querySelectorAll("[data-vcf-stone]").forEach((g) => { board[Number(g.getAttribute("data-vcf-stone"))] = Number(g.getAttribute("data-vcf-player")); });
  const side = document.querySelector(".vcfch-side-chip b")?.textContent?.trim() === "白" ? "white" : "black";
  const atkCode = side === "black" ? 1 : 2, defCode = side === "black" ? 2 : 1;
  const deadline = Date.now() + 9000; const budget = { n: 12000 };
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

/** 采一段 trace 并统计。 */
async function trace(durMs) {
  const events = [];
  const onData = ({ value }) => { for (const e of value) events.push(e); };
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink,cc", transferMode: "ReportEvents" });
  await page.waitForTimeout(durMs);
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);

  const span = new Map(); // name -> {count, total}
  let frameCount = 0, frameDurTotal = 0;
  const longFrames = [];
  for (const e of events) {
    if (e.ph !== "X") continue;
    const d = e.dur ?? 0;
    if (e.name === "DrawFrame" || e.name === "BeginFrame" || e.name === "ActivateLayerTree") {
      if (e.name === "DrawFrame") { frameCount += 1; frameDurTotal += d; if (d > 50000) longFrames.push(Math.round(d / 1000)); }
    }
    const key = e.name;
    if (["Paint", "UpdateLayoutTree", "UpdateLayerTree", "Animation", "CompositeLayers", "Layerize", "PrePaint", "Layout", "HitTest", "ParseStyleSheet", "RecalcStyle", "StyleRecalcInvalidationTracking", "Commit", "CommitLoad", "RasterTask", "ImageDecodeTask", "GPUTask", "PaintArtifactCompositor", "UpdateLayer"].includes(key)) {
      const cur = span.get(key) ?? { count: 0, total: 0, max: 0 };
      cur.count += 1; cur.total += d; cur.max = Math.max(cur.max, d);
      span.set(key, cur);
    }
  }
  const byMs = {};
  for (const [k, v] of span) byMs[k] = { count: v.count, totalMs: +(v.total / 1000).toFixed(1), maxMs: +(v.max / 1000).toFixed(2) };
  return { frames: frameCount, drawTotalMs: +(frameDurTotal / 1000).toFixed(1), longFrames, byMs };
}

const inject = (id, css) => page.evaluate(([i, c]) => {
  document.getElementById(i)?.remove();
  const el = document.createElement("style"); el.id = i; el.textContent = c; document.head.appendChild(el);
}, [id, css]);
const removeStyle = (id) => page.evaluate((i) => document.getElementById(i)?.remove(), id);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("vcfch-state-v1") || "{}");
  Object.assign(s, { rating: 1000, solvedIds: [], seenIds: [], solved: 0, failed: 0, streak: 0, bestStreak: 0, daily: {}, history: [], settings: { pace: "default", genDeep: true } });
  localStorage.setItem("vcfch-state-v1", JSON.stringify(s));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="主导航"]');
  Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click();
});
await page.waitForTimeout(400);
await page.locator('[data-duel-entry="vcf"] [data-duel-vcf-start]').click();
await page.locator(".vcfch-board").waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
if (!await waitPrimary("认输（判负）", 60000)) { console.log("没进 playing"); process.exit(1); }

const s = await solve();
if (!s.line) { console.log("本题未解出"); process.exit(1); }
console.log(`题目解出：执${s.side}，${s.line.length} 手。CPU 降速 ${RATE}×。\n`);

/** 完整一轮：可选注入旧样式 → 落子取胜 → 采段A/段B → 截图。解不出题时自动重试（换题）。 */
async function runRound(mode) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // 上一轮结算后主按钮是「下一题」；点它进下一题（首轮是「开始挑战」）
    await page.evaluate(() => document.querySelector(".vcfch-bottom .vcfch-primary")?.click());
    if (!await waitPrimary("认输（判负）", 60000)) continue;
    if (mode === "old") await inject("ab-old", OLD_CSS); else { await removeStyle("ab-old"); }
    const sol = await solve();
    if (!sol.line) continue;
    for (const idx of sol.line) { await tapIdx(idx); if (await primary() !== "认输（判负）") break; }
    if (!await waitPrimary("下一题", 20000)) continue;
    // 段A：入场期（弹窗出现 0–2.2s）
    const A = await trace(2200);
    await page.screenshot({ path: `${SHOTS}/trace-${mode}-entry.png` });
    // 段B：持续期（2.2–8s）
    const B = await trace(5800);
    await page.screenshot({ path: `${SHOTS}/trace-${mode}-steady.png` });
    return { A, B };
  }
  return null;
}

await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });

const out = {};
for (const mode of ["old", "new", "old", "new"]) {
  const r = await runRound(mode);
  if (!r) { console.log(`${mode} 轮次失败`); continue; }
  (out[mode] ??= []).push(r);
  const fmt = (t, label) => {
    const b = t.byMs;
    const p = (k) => b[k] ? `${b[k].totalMs}ms/${b[k].count}次` : "—";
    console.log(`  ${label}: 帧${t.frames} 帧总耗时${t.drawTotalMs}ms | Paint ${p("Paint")} | 样式 ${p("UpdateLayoutTree")} | 动画 ${p("Animation")} | 合成 ${p("CompositeLayers")} | 长帧(>50ms) ${t.longFrames.length}${t.longFrames.length ? " [" + t.longFrames.slice(0, 6).join(",") + "]" : ""}`);
  };
  console.log(`${mode} 轮次：`);
  fmt(r.A, "段A入场0-2.2s");
  fmt(r.B, "段B持续2.2-8s");
}

await browser.close();
console.log(`\n截图：${SHOTS}/trace-{old,new}-{entry,steady}.png。页面错误 ${errs.length} 条`);
if (errs.length) console.log(errs.slice(0, 3).join("\n"));

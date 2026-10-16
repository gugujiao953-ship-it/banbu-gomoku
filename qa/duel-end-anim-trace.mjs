/**
 * qa/duel-end-anim-trace.mjs — 人机对战终局动效（胜/负/和）的**渲染管线级**对比 + 几何测量（用户 10-07）。
 *
 * 背景：与 VCF 挑战同一套「终局弹窗」动效（印 × 流 × 光）。三态各自的持续动画：
 *   胜  duel-end-wave-won    — clip-path:path() 逐帧形变（无法 GPU 合成，每帧重绘整块渐变）
 *   负  duel-end-wave-lost   — 同上；另有已删除的 `duel-end-vignette`（inset:-26px 溢出卡外，
 *                              用户 10-07 报「灰色部分往外溢出，搞得屏幕灰灰的」）
 *   和  duel-end-sweep       — background-position 动画（同样每帧重绘渐变）
 *
 * ⚠ 测量方法（踩过的坑）：**每个组合必须用全新页面加载测一次**。
 *   在同一页面里反复注入/移除样式会让图层与栅格尺度反复失效，测出来的 Paint 次数
 *   前后能差一个数量级（同一实现先测 618ms 再测 47ms），完全不可比。
 *
 * 用法：node qa/duel-end-anim-trace.mjs [base] [cpuRate]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";
const RATE = Number(process.argv[3] ?? 4);
const SHOTS = "qa/tmp-duel-ab";
mkdirSync(SHOTS, { recursive: true });

/** 旧实现（修复前原样，从改前的 CSS 抄回）。 */
const OLD_CSS = `
.duel-end--won .duel-end-flow{animation:duel-end-riseflow 1.5s .35s cubic-bezier(.25,.8,.3,1) backwards, duel-end-wave-won 5s .5s ease-in-out infinite alternate !important}
.duel-end--lost .duel-end-flow{animation:duel-end-fallflow 1.5s .35s cubic-bezier(.25,.8,.3,1) backwards, duel-end-wave-lost 5.6s .5s ease-in-out infinite alternate !important}
.duel-end--draw .duel-end-flow{animation:duel-end-fade 1s .3s ease-out backwards, duel-end-sweep 7.5s ease-in-out infinite alternate !important}
.duel-end--draw .duel-end-flow::before{display:none}
@keyframes duel-end-wave-won{0%{clip-path:path("M0,120 C60,86 120,132 190,104 C250,80 300,116 344,92 L344,400 L0,400 Z")}100%{clip-path:path("M0,98 C62,134 122,78 192,126 C252,152 302,88 344,118 L344,400 L0,400 Z")}}
@keyframes duel-end-wave-lost{0%{clip-path:path("M0,0 L344,0 L344,120 C292,146 242,104 182,132 C122,160 62,120 0,142 Z")}100%{clip-path:path("M0,0 L344,0 L344,142 C296,110 240,158 180,124 C120,94 60,142 0,112 Z")}}
@keyframes duel-end-sweep{from{background-position:0% 50%}to{background-position:100% 50%}}
.duel-end--draw .duel-end-flow{background-size:165% 100% !important}
.duel-end-vignette{position:absolute;inset:-26px;border-radius:34px;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 46%,transparent 40%,#05070a8c 82%) !important;opacity:1 !important}
`;

const browser = await chromium.launch({ headless: true });

/** 进对局 → 认输 → 终局，返回 { page, cdp, ctx }。 */
async function openEnding(mode, outcome) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const clickSel = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.click(); return true; } return false; }, sel);
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(150); } };

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
  await page.waitForTimeout(500);
  await clickSel('[data-duel-entry="ai"] button');
  await page.waitForTimeout(1200);
  await clickSel(".ai-start-button");
  if (!await waitFor(async () => Boolean(await page.$("[data-duel-screen]")), 40000)) { console.log("没进对局界面"); return null; }
  await page.waitForTimeout(1200);
  await clickSel("[data-duel-resign]");
  await page.waitForTimeout(400);
  await clickSel("[data-duel-confirm-ok]");
  if (!await waitFor(async () => Boolean(await page.$("[data-duel-result]")), 30000)) { console.log("没出终局弹窗"); return null; }
  // 切到目标态（真实结算只可能是负；胜/和靠 modifier 渲染，只为量渲染开销）
  if (outcome !== "lost") await page.evaluate((o) => {
    const el = document.querySelector(".duel-end");
    el.classList.remove("duel-end--lost"); el.classList.add(`duel-end--${o}`);
    const s = el.querySelector(".duel-end-stamp"); if (s) s.childNodes[0].nodeValue = o === "won" ? "胜" : "和";
  }, outcome);
  if (mode === "old") await page.addStyleTag({ content: OLD_CSS });
  await page.waitForTimeout(2600); // 等入场动画（≤1.85s）与图层稳定
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  await page.waitForTimeout(400);
  return { page, cdp, ctx, errs };
}

async function trace(page, cdp, durMs) {
  const events = [];
  const onData = ({ value }) => { for (const e of value) events.push(e); };
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink,cc", transferMode: "ReportEvents" });
  await page.waitForTimeout(durMs);
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end"); await done;
  cdp.off("Tracing.dataCollected", onData);
  const span = new Map();
  const longFrames = [];
  for (const e of events) {
    if (e.ph !== "X") continue;
    if (e.name === "DrawFrame" && (e.dur ?? 0) > 50000) longFrames.push(Math.round((e.dur ?? 0) / 1000));
    if (["Paint", "RasterTask", "UpdateLayoutTree", "CompositeLayers", "GPUTask"].includes(e.name)) {
      const cur = span.get(e.name) ?? { count: 0, total: 0 };
      cur.count += 1; cur.total += (e.dur ?? 0); span.set(e.name, cur);
    }
  }
  const out = {};
  for (const [k, v] of span) out[k] = { ms: +(v.total / 1000).toFixed(1), n: v.count };
  out.longFrames = longFrames.length;
  return out;
}

console.log(`CPU 降速 ${RATE}×；每个组合全新页面测 6 秒。\n`);
console.log("模式 终局   Paint        光栅(Raster)   样式重算      合成        长帧>50ms");
const results = {};
for (const mode of ["old", "new"]) {
  for (const outcome of ["lost", "won", "draw"]) {
    const h = await openEnding(mode, outcome);
    if (!h) continue;
    const t = await trace(h.page, h.cdp, 6000);
    await h.page.screenshot({ path: `${SHOTS}/${mode}-${outcome}.png` });
    const g = await h.page.evaluate(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      return { card: r(".duel-end-card"), flow: r(".duel-end-flow"), clip: r(".duel-end-flowclip") };
    });
    results[`${mode}-${outcome}`] = { t, g };
    const f = (k) => t[k] ? `${String(t[k].ms).padStart(6)}ms/${String(t[k].n).padStart(4)}次` : "         —     ";
    console.log(`${mode.padEnd(4)} ${outcome.padEnd(5)} ${f("Paint")} ${f("RasterTask")} ${f("UpdateLayoutTree")} ${f("CompositeLayers")}  ${t.longFrames}`);
    await h.ctx.close();
  }
}
await browser.close();

console.log("\n几何（负局，供振幅取值的依据）：");
const gl = results["new-lost"]?.g;
if (gl) {
  console.log("  卡片", JSON.stringify(gl.card), "\n  色流", JSON.stringify(gl.flow), "\n  裁剪", JSON.stringify(gl.clip));
}
console.log(`\n截图：${SHOTS}/{old,new}-{lost,won,draw}.png`);

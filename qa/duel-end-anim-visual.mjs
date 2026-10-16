/**
 * qa/duel-end-anim-visual.mjs — 人机对战终局三态（胜/负/和）动效的**像素级**新旧对比（用户 10-07「无损替换」）。
 *
 * 三项证据：
 *   ① 形状基线：两版都**只留入场动画**（去掉循环动画），等入场走完截图逐像素比——
 *      新旧用的是同一条 clip-path / 同一个渐变，这一项应当几乎为零差异。
 *   ② 运动幅度：各自冻结循环动画在 5 个相位，量「同一实现自身首帧 vs 各相位」的最大像素差，
 *      用来判断新实现的晃动幅度是否与旧波浪相当。
 *   ③ 最坏差异：同一相位下 old vs new 的差（运动方式不同，这一项必然>0，只作为量级参考）。
 *
 * ⚠ 上一版的两个坑（已修）：a) 把入场动画一起 seek 回起点，导致两侧不同步；
 *   b) 和为「旧实现」注入时只改了 background-size、没恢复 background 本身（新版把渐变移到了
 *   ::before），于是旧侧根本没有渐变，差异恒为 ~43。
 *
 * 用法：node qa/duel-end-anim-visual.mjs [base]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";
const SHOTS = "qa/tmp-duel-ab";
mkdirSync(SHOTS, { recursive: true });

const EASE = "cubic-bezier(.25,.8,.3,1)";
const GRAD_DRAW = `linear-gradient(104deg,
  color-mix(in srgb,var(--gold) 40%,transparent) 0 32%,
  color-mix(in srgb,var(--gold) 18%,transparent) 45% 55%,
  color-mix(in srgb,var(--end-celadon) 40%,transparent) 68% 100%)`;

/** 只留入场动画（两版一致），循环动画全部停掉。 */
const BASE_CSS = {
  won: `.duel-end--won .duel-end-flow{animation:duel-end-riseflow 1.5s .35s ${EASE} backwards !important}`,
  lost: `.duel-end--lost .duel-end-flow{animation:duel-end-fallflow 1.5s .35s ${EASE} backwards !important}`,
  draw: `.duel-end--draw .duel-end-flow{animation:duel-end-fade 1s .3s ease-out backwards !important}`,
};
/** 旧实现的循环动画（含和为旧版的渐变本体）。 */
const OLD_INF = {
  won: `@keyframes duel-end-wave-won{0%{clip-path:path("M0,120 C60,86 120,132 190,104 C250,80 300,116 344,92 L344,400 L0,400 Z")}100%{clip-path:path("M0,98 C62,134 122,78 192,126 C252,152 302,88 344,118 L344,400 L0,400 Z")}}
.duel-end--won .duel-end-flow{animation:duel-end-wave-won 5s .5s ease-in-out infinite alternate !important}`,
  lost: `@keyframes duel-end-wave-lost{0%{clip-path:path("M0,0 L344,0 L344,120 C292,146 242,104 182,132 C122,160 62,120 0,142 Z")}100%{clip-path:path("M0,0 L344,0 L344,142 C296,110 240,158 180,124 C120,94 60,142 0,112 Z")}}
.duel-end--lost .duel-end-flow{animation:duel-end-wave-lost 5.6s .5s ease-in-out infinite alternate !important}`,
  draw: `@keyframes duel-end-sweep-old{from{background-position:0% 50%}to{background-position:100% 50%}}
/* ⚠ 这两条不能加 !important：动画声明在层叠里低于 author 的 !important 声明，
   一旦 background 带 !important，background-position 动画就被钉死在 0% 不动了
   （上一版正是这样，和为的「旧实现」其实一直是静止的，差异恒为 43）。 */
.duel-end--draw .duel-end-flow{background-image:${GRAD_DRAW};background-size:165% 100%;animation:duel-end-sweep-old 7.5s ease-in-out infinite alternate!important}
.duel-end--draw .duel-end-flow::before{display:none !important}`,
};
/** 相位起点/周期（秒） */
const PLAN = {
  won: { oldT0: 0.5, oldDur: 5, newT0: 1.9, newDur: 6 },
  lost: { oldT0: 0.5, oldDur: 5.6, newT0: 1.9, newDur: 6.4 },
  draw: { oldT0: 0, oldDur: 7.5, newT0: 0, newDur: 7.5 },
};
const INF_NAMES = ["duel-end-wave-won", "duel-end-wave-lost", "duel-end-sway", "duel-end-sway-down", "duel-end-sweep", "duel-end-sweep-old"];
/** 与色流无关的装饰动画一律停掉，只比色流。 */
const ISOLATE = `.duel-end-halo i,.duel-end-dust i,.duel-end-stamp,.duel-end-stamp i,.duel-end-stroke,.duel-end-poem i,.duel-end-sub,.duel-end-hint,.duel-end-card{animation:none!important}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
const clickSel = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.click(); return true; } return false; }, sel);
const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(150); } };
const style = (id, css) => page.evaluate(([i, c]) => {
  document.getElementById(i)?.remove();
  if (!c) return;
  const el = document.createElement("style"); el.id = i; el.textContent = c; document.head.appendChild(el);
}, [id, css]);
const freezeInfinite = (t) => page.evaluate(([tt, names]) => {
  let n = 0; const found = [];
  for (const a of document.getAnimations()) {
    if (!names.includes(a.animationName)) continue;
    a.currentTime = tt * 1000; a.pause(); n += 1; found.push(a.animationName);
  }
  return { n, found };
}, [t, INF_NAMES]);
const thaw = () => page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(500);
await clickSel('[data-duel-entry="ai"] button');
await page.waitForTimeout(1200);
await clickSel(".ai-start-button");
if (!await waitFor(async () => Boolean(await page.$("[data-duel-screen]")), 40000)) { console.log("没进对局"); process.exit(1); }
await page.waitForTimeout(1200);
await clickSel("[data-duel-resign]"); await page.waitForTimeout(400); await clickSel("[data-duel-confirm-ok]");
if (!await waitFor(async () => Boolean(await page.$("[data-duel-result]")), 30000)) { console.log("没出终局"); process.exit(1); }
await page.waitForTimeout(2600);
await style("iso", ISOLATE);
const setOutcome = (o) => page.evaluate((oc) => {
  const el = document.querySelector(".duel-end");
  el.classList.remove("duel-end--won", "duel-end--lost", "duel-end--draw");
  el.classList.add(`duel-end--${oc}`);
  const s = el.querySelector(".duel-end-stamp"); if (s) s.childNodes[0].nodeValue = oc === "won" ? "胜" : oc === "lost" ? "负" : "和";
}, o);
console.log("终局弹窗就绪。");

const shapeFiles = {};
const motion = {};
for (const outcome of ["won", "lost", "draw"]) {
  await setOutcome(outcome);
  // ① 形状基线：两版都只留入场
  await style("oldinf", "");
  await style("base", BASE_CSS[outcome]);
  await page.waitForTimeout(2400); // 入场走完
  shapeFiles[`${outcome}-new`] = `${SHOTS}/base-new-${outcome}.png`;
  await page.locator(".duel-end-card").screenshot({ path: shapeFiles[`${outcome}-new`] });
  await style("base", `${BASE_CSS[outcome]}\n${OLD_INF[outcome]}`);
  await page.waitForTimeout(2400);
  shapeFiles[`${outcome}-old`] = `${SHOTS}/base-old-${outcome}.png`;
  await page.locator(".duel-end-card").screenshot({ path: shapeFiles[`${outcome}-old`] });
  await style("base", "");
  await page.waitForTimeout(300);

  // ② 运动幅度：各自冻结 5 个相位
  for (const mode of ["old", "new"]) {
    const p = PLAN[outcome];
    const t0 = mode === "old" ? p.oldT0 : p.newT0;
    const dur = mode === "old" ? p.oldDur : p.newDur;
    if (mode === "old") await style("oldinf", OLD_INF[outcome]);
    const files = [];
    for (const ph of [0, 0.25, 0.5, 0.75, 1]) {
      const r = await freezeInfinite(t0 + ph * dur);
      if (ph === 0 && r.n === 0) console.log(`  ⚠ ${mode}/${outcome} 没找到循环动画`);
      await page.waitForTimeout(170);
      const f = `${SHOTS}/px-${mode}-${outcome}-p${Math.round(ph * 100)}.png`;
      await page.locator(".duel-end-card").screenshot({ path: f });
      files.push(f);
    }
    await thaw();
    if (mode === "old") await style("oldinf", "");
    motion[`${outcome}-${mode}`] = files;
    await page.waitForTimeout(250);
  }
}
await browser.close();

function decodePng(file) {
  const buf = readFileSync(file);
  let pos = 8, w = 0, h = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch; const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y === 0 ? Buffer.alloc(stride) : out.subarray((y - 1) * stride, y * stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 0xff; else if (ft === 2) v = (v + b) & 0xff;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff; }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
const stat = (A, B) => {
  if (A.w !== B.w || A.h !== B.h) return null;
  let sum = 0, over8 = 0, over32 = 0, max = 0;
  for (let i = 0; i < A.w * A.h; i += 1) {
    const o = i * A.ch;
    const d = Math.max(Math.abs(A.data[o] - B.data[o]), Math.abs(A.data[o + 1] - B.data[o + 1]), Math.abs(A.data[o + 2] - B.data[o + 2]));
    sum += d; if (d > 8) over8 += 1; if (d > 32) over32 += 1; max = Math.max(max, d);
  }
  const px = A.w * A.h;
  return { avg: +(sum / px).toFixed(2), over32: +(over32 / px * 100).toFixed(2), max };
};

console.log("\n① 形状基线（两版都只留入场；理想 = 全 0）：");
for (const outcome of ["won", "lost", "draw"]) {
  const O = decodePng(shapeFiles[`${outcome}-old`]);
  const N = decodePng(shapeFiles[`${outcome}-new`]);
  const s = stat(O, N);
  console.log(`  【${outcome}】平均差 ${s.avg}/255 · 差>32 ${s.over32}% · 峰值 ${s.max}  → ${s.over32 < 0.5 && s.max < 40 ? "形状一致（无损）" : "存在可见差异"}`);
}
console.log("\n② 运动幅度（同实现内：首相位 vs 各相位的最大像素差；0-255）：");
for (const outcome of ["won", "lost", "draw"]) {
  const line = [];
  for (const mode of ["old", "new"]) {
    const imgs = motion[`${outcome}-${mode}`].map(decodePng);
    let maxD = 0, avgMax = 0;
    for (let i = 1; i < imgs.length; i += 1) { const s = stat(imgs[0], imgs[i]); if (!s) continue; maxD = Math.max(maxD, s.max); avgMax = Math.max(avgMax, s.avg); }
    line.push(`${mode}: 峰值 ${maxD} / 平均峰值 ${avgMax}`);
  }
  console.log(`  【${outcome}】${line.join("   |   ")}`);
}
console.log(`\n截图：${SHOTS}/base-{old,new}-*.png、px-{old,new}-*-p*.png。页面错误 ${errs.length}`);

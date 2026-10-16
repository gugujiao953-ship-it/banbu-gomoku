/**
 * qa/vcf-end-anim-waveonly.mjs — 只比较**金浪本身**（关掉金晕/金粉/印章等其它动画），
 * 回答「形状是否无损 + 幅度是否相当」。用户 10-07「是不是可以完美无损」。
 *
 * 关键设计：old 与 new 都关掉 halo/dust 等干扰元素，只让色流动画跑；把色流动画 seek 到
 * 各自周期的同相位点截图，逐像素比 + 逐列浪尖轮廓比。
 * 用法：node qa/vcf-end-anim-waveonly.mjs [base]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "http://localhost:5210/?qa=1";
const SHOTS = "qa/tmp-vcf-ab";
mkdirSync(SHOTS, { recursive: true });
const VIEW = 572, MARGIN = 46, CELL = (572 - 92) / 14;

/** 旧实现（修复前原样）+ 关掉干扰元素。 */
const OLD_CSS = `
.vcfch-end-halo i, .vcfch-end-dust i { animation: none !important; opacity: 0 !important; }
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
/** 新实现同款干扰屏蔽（只留色流）。 */
const NEW_CSS = `.vcfch-end-halo i, .vcfch-end-dust i { animation: none !important; opacity: 0 !important; }`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

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
      path.pop(); if (budget.n <= 0) return null;
    }
    return null;
  };
  return { side, line: dfs(board, []) };
});
const inject = (id, css) => page.evaluate(([i, c]) => {
  document.getElementById(i)?.remove();
  const el = document.createElement("style"); el.id = i; el.textContent = c; document.head.appendChild(el);
}, [id, css]);
const removeStyle = (id) => page.evaluate((i) => document.getElementById(i)?.remove(), id);

/** 只 seek 色流元素的动画（其它已关）。 */
const seekFlow = (t) => page.evaluate((tt) => {
  const el = document.querySelector(".vcfch-end--won .vcfch-end-flow");
  if (!el) return 0;
  let n = 0;
  for (const a of el.getAnimations()) { a.currentTime = tt * 1000; a.pause(); n += 1; }
  return n;
}, t);

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
console.log(`题目解出：执${s.side}，${s.line.length} 手。`);
for (const idx of s.line) { await tapIdx(idx); if (await primary() !== "认输（判负）") break; }
if (!await waitPrimary("下一题", 20000)) { console.log("未进入结算"); process.exit(1); }
await page.waitForTimeout(2600);

/** 相位采样：old 周期 5s（起 .5s），new 周期 6s（起 1.9s）。取 0/25/50/75/100% 五个相位。 */
async function sample(mode, css, t0, period) {
  await inject(`ab-${mode}`, css);
  await page.waitForTimeout(250);
  const files = [];
  for (const ph of [0, 0.25, 0.5, 0.75, 1]) {
    const t = t0 + ph * period;
    await seekFlow(t);
    await page.waitForTimeout(180);
    const f = `${SHOTS}/wave-${mode}-p${Math.round(ph * 100)}.png`;
    await page.locator(".vcfch-end-card").screenshot({ path: f });
    files.push(f);
  }
  await removeStyle(`ab-${mode}`);
  return files;
}

console.log("\n采样（只留色流，关掉金晕/金粉）…");
const oldFiles = await sample("old", OLD_CSS, 0.5, 5);
const newFiles = await sample("new", NEW_CSS, 1.9, 6);
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
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y === 0 ? Buffer.alloc(stride) : out.subarray((y - 1) * stride, y * stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 0xff;
      else if (ft === 2) v = (v + b) & 0xff;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}
/** 每列最上方的「明显金色」像素（阈值收紧，排除极淡的抗锯齿边缘）。 */
const isGold = (r, g, b) => r > 170 && r - b > 45 && g > b + 8 && g > 110;
function crest(img) {
  const { w, h, ch, data } = img; const res = [];
  for (let x = 0; x < w; x += 1) {
    let y = -1;
    for (let yy = 0; yy < h; yy += 1) {
      const i = (yy * w + x) * ch;
      if (isGold(data[i], data[i + 1], data[i + 2])) { y = yy; break; }
    }
    res.push(y);
  }
  return res;
}
function diffStat(a, b) {
  let sum = 0, over8 = 0, over32 = 0;
  for (let i = 0; i < a.w * a.h; i += 1) {
    const o = i * a.ch;
    const d = Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]);
    sum += d; if (d > 8) over8 += 1; if (d > 32) over32 += 1;
  }
  const px = a.w * a.h;
  return { avg: +(sum / px / 3).toFixed(2), over8Pct: +(over8 / px * 100).toFixed(2), over32Pct: +(over32 / px * 100).toFixed(2) };
}

const oldI = oldFiles.map(decodePng), newI = newFiles.map(decodePng);
const phases = ["0%", "25%", "50%", "75%", "100%"];
console.log(`\n① 同相位逐像素比较（old vs new，图 ${oldI[0].w}×${oldI[0].h}）：`);
phases.forEach((p, i) => {
  const d = diffStat(oldI[i], newI[i]);
  console.log(`   相位 ${p.padEnd(5)} 平均差 ${String(d.avg).padStart(5)}/255 · 差>8 像素 ${String(d.over8Pct).padStart(5)}% · 差>32 像素 ${d.over32Pct}%`);
});

console.log("\n② 浪尖轮廓（每列最上方金色像素 y，越小越高）：");
for (const [name, imgs] of [["old", oldI], ["new", newI]]) {
  const stats = imgs.map((im) => {
    const cr = crest(im).filter((y) => y >= 0);
    return { min: cr.length ? Math.min(...cr) : null, avg: cr.length ? +(cr.reduce((a, b) => a + b, 0) / cr.length).toFixed(1) : null, n: cr.length };
  });
  console.log(`   ${name}: ` + stats.map((st, i) => `${phases[i]} y=${st.avg}(最低${st.min})`).join("  "));
}
console.log("\n③ 逐列浪尖的**运动幅度**（同模式五个相位里，每列浪尖 y 的极差）：");
for (const [name, imgs] of [["old", oldI], ["new", newI]]) {
  const crests = imgs.map((im) => crest(im));
  const w = imgs[0].w;
  const ranges = [];
  for (let x = 0; x < w; x += 1) {
    const ys = crests.map((c) => c[x]).filter((y) => y >= 0);
    if (ys.length < 5) continue;
    ranges.push(Math.max(...ys) - Math.min(...ys));
  }
  if (!ranges.length) { console.log(`   ${name}: 无可比列`); continue; }
  ranges.sort((a, b) => a - b);
  const avg = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  console.log(`   ${name}: 平均 ${avg.toFixed(1)}px · 中位 ${ranges[Math.floor(ranges.length / 2)]}px · 最大 ${ranges[ranges.length - 1]}px（共 ${ranges.length} 列）`);
}
console.log(`\n截图：${SHOTS}/wave-{old,new}-p{0,25,50,75,100}.png。错误 ${errs.length}`);

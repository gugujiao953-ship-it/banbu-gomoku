/**
 * qa/theme-refactor-probe.mjs — 两问各半（用户 10-07：「放一会就断了」+「重构会不会更流畅」）。
 *
 * ① 动画到底有没有在动：每隔 400ms 截一张，比较「只有背景可见」那一行像素——
 *    若多帧完全一样，说明光栅跟不上、用户看到的就是停住的画面。
 * ② 模拟重构：把动画从 `.app-shell`（承载全部 UI 的大层）搬到**独立固定层**并用 transform，
 *    其余 DOM 不动，实测 Paint/光栅降到多少。（只在页面运行时注入，不改仓库任何文件）
 *
 * 用法：node qa/theme-refactor-probe.mjs [base] [cpuRate]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";
const RATE = Number(process.argv[3] ?? 4);
const SHOTS = "qa/tmp-theme-audit";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const cdp = await ctx.newCDPSession(page);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });

async function trace(durMs) {
  const events = [];
  const onData = ({ value }) => { for (const e of value) events.push(e); };
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink,cc", transferMode: "ReportEvents" });
  await page.waitForTimeout(durMs);
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end"); await done;
  cdp.off("Tracing.dataCollected", onData);
  const span = new Map();
  for (const e of events) {
    if (e.ph !== "X") continue;
    if (["Paint", "RasterTask", "UpdateLayoutTree"].includes(e.name)) {
      const cur = span.get(e.name) ?? { count: 0, total: 0 };
      cur.count += 1; cur.total += (e.dur ?? 0); span.set(e.name, cur);
    }
  }
  return [...span].map(([k, v]) => `${k} ${(v.total / 1000).toFixed(0)}ms/${v.count}`).join(" · ") || "（无）";
}
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
/** 取某一行的像素（默认底部背景带，那里没内容遮挡）。 */
const rowOf = (img, yFrac) => {
  const y = Math.floor(img.h * yFrac);
  const out = [];
  for (let x = 0; x < img.w; x += 1) { const o = (y * img.w + x) * img.ch; out.push([img.data[o], img.data[o + 1], img.data[o + 2]]); }
  return out;
};
const rowsEqual = (a, b) => {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) { const d = Math.max(Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1]), Math.abs(a[i][2] - b[i][2])); if (d > 2) diff += 1; }
  return { diffPx: diff, pct: +(diff / a.length * 100).toFixed(1) };
};

for (const theme of ["bamboo", "rain"]) {
  console.log(`\n═══ ${theme} ═══`);
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(1500);
  console.log("现状      :", await trace(4000));

  // ① 动画是否真的在渲染：连拍 8 张，比较背景带那一行
  const shots = [];
  for (let i = 0; i < 8; i += 1) {
    const f = `${SHOTS}/probe-${theme}-${i}.png`;
    await page.screenshot({ path: f });
    shots.push(f);
    await page.waitForTimeout(400);
  }
  const imgs = shots.map(decodePng);
  const row = 0.965; // 底部导航下方那条纯背景带
  const cmp = [];
  for (let i = 1; i < imgs.length; i += 1) cmp.push(rowsEqual(rowOf(imgs[0], row), rowOf(imgs[i], row)).pct);
  console.log(`① 连拍 8 张（间隔 400ms）：背景带像素与前一张的变化比例 = ${cmp.map((c) => c + "%").join(" / ")}`);
  console.log(`   → ${cmp.filter((c) => c > 1).length >= 4 ? "动画确实在渲染（多数帧有变化）" : "多数帧画面没变 → 看起来是停住的"}`);

  // ② 模拟重构：独立固定层 + transform
  await page.evaluate((t) => {
    const th = t;
    const cfg = {
      bamboo: {
        img: 'linear-gradient(180deg,#e8eee5b8,#f2f1e8d9 58%,#d5dfd4b0),url("/theme-assets/falling-leaves.svg"),url("/theme-assets/bamboo-ink.svg")',
        size: "cover,430px 560px,1200px 800px",
        anim: "probe-bamboo 15s linear infinite",
        kf: `@keyframes probe-bamboo{to{transform:translate(54px,1120px)}}`,
        shift: "translate(0,0)",
      },
      rain: {
        img: 'repeating-linear-gradient(108deg,transparent 0 27px,#b8d8db45 28px,#b8d8db45 29px,transparent 30px 72px),linear-gradient(155deg,#1a292c,#2b4447 58%,#162326)',
        size: "110px 190px,100% 100%",
        anim: "probe-rain 1.8s linear infinite",
        kf: `@keyframes probe-rain{to{transform:translate(55px,190px)}}`,
        shift: "translate(0,0)",
      },
    }[th];
    // 关掉 app-shell 上的背景动画（保留背景色，避免整页变白）
    const st = document.createElement("style");
    st.id = "probe-refactor";
    st.textContent = `
      html[data-theme="${th}"] .app-shell{animation:none !important;background-image:none !important;background-color:${th === "rain" ? "#1d2c2e" : "#e7eadf"} !important}
      #probe-layer{position:fixed;inset:-1200px 0 0 0;z-index:0;pointer-events:none;
        background-image:${cfg.img};background-size:${cfg.size};background-position:0 0;
        will-change:transform;animation:${cfg.anim}}
      ${cfg.kf}
    `;
    document.head.appendChild(st);
    const layer = document.createElement("div");
    layer.id = "probe-layer";
    document.body.appendChild(layer);
  }, theme);
  await page.waitForTimeout(1200);
  console.log("模拟重构后:", await trace(4000));
  await page.screenshot({ path: `${SHOTS}/probe-${theme}-refactor.png` });
  await page.evaluate(() => { document.getElementById("probe-refactor")?.remove(); document.getElementById("probe-layer")?.remove(); });
  await page.waitForTimeout(300);
}
await browser.close();
console.log(`\n截图：${SHOTS}/probe-*.png`);

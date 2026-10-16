/**
 * qa/theme-motion-audit.mjs — 动态主题背景体检（用户 10-07：「有些动态主题不完整，放一会就断了，无法像循环一样播放」）。
 *
 * 两件事分开量：
 *  ① 渲染开销：每个主题跑 4 秒，统计 Paint / 光栅 / 样式重算 / 合成 的耗时与次数。
 *     所有主题背景都靠 `background-position` 动画（每帧重绘整屏）——用数据看谁最贵。
 *  ② 循环接缝：把该主题的动画冻结在「t=0」和「t=周期-50ms」两处截图逐像素比。
 *     无缝循环时两帧应当一致；有跳变说明每圈都会「断」一下（用户看到的可能就是它）。
 *
 * 用法：node qa/theme-motion-audit.mjs [base] [cpuRate]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";
const RATE = Number(process.argv[3] ?? 4);
const SHOTS = "qa/tmp-theme-audit";
mkdirSync(SHOTS, { recursive: true });

/** 主题 → 动画时长（秒）。alternate 的循环周期 = 时长×2；多套动画取并集。
 *  ⚠ 2026-10-07 起雨幕/水墨竹林/雪落/萤火森林/极光已改用「主题场景层」的 transform 动画，
 *  周期与旧 background-position 版不同（见下面 P 值）；接缝必须在**所有图层同时回到循环点**
 *  时比较，否则测出来的是相位差、不是接缝。P = 各图层循环周期的最小公倍数。 */
const THEMES = [
  { id: "rain", dur: [3.6, 1.7], alt: [false, false], note: "雨幕", P: 61.2 },
  { id: "bamboo", dur: [16, 15], alt: [true, false], note: "水墨竹林", P: 480 },
  { id: "snow", dur: [9, 17], alt: [false, false], note: "雪落", P: 153 },
  { id: "porcelain", dur: [18], alt: [true], note: "青花瓷影" },
  { id: "plum", dur: [16], alt: [true], note: "梅枝映雪" },
  { id: "jiangnan", dur: [4.2, 2.2], alt: [false, false], note: "夜雨江南", P: 46.2 },
  { id: "firefly", dur: [26, 11, 11], alt: [false, false, true], note: "萤火森林", P: 286 },
  { id: "cyber", dur: [20], alt: [false], note: "霓虹赛博" },
  { id: "kawaii", dur: [18, 9], alt: [true, true], note: "卡哇伊" },
  { id: "aurora", dur: [22], alt: [true], note: "极光（各元素周期互质，整体无统一循环点：每条各自 alternate 无缝）", P: 0.001 },
  { id: "deepsea", dur: [12, 8], alt: [true, true], note: "深海幽蓝" },
  { id: "baroque", dur: [18, 10], alt: [true, false], note: "巴洛克" },
  { id: "blackgold", dur: [8], alt: [false], note: "尊贵黑金" },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
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
    if (["Paint", "RasterTask", "UpdateLayoutTree", "CompositeLayers"].includes(e.name)) {
      const cur = span.get(e.name) ?? { count: 0, total: 0 };
      cur.count += 1; cur.total += (e.dur ?? 0); span.set(e.name, cur);
    }
  }
  const o = {};
  for (const [k, v] of span) o[k] = { ms: +(v.total / 1000).toFixed(1), n: v.count };
  return o;
}

/** 冻结所有「背景层」动画到 t 秒（含伪元素）。 */
const freeze = (t) => page.evaluate((tt) => {
  let n = 0;
  for (const a of document.getAnimations()) {
    a.currentTime = tt * 1000;
    a.pause();
    n += 1;
  }
  return n;
}, t);
const thaw = () => page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });

const rows = [];
for (const th of THEMES) {
  await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, th.id);
  await page.waitForTimeout(1200); // 让背景图解码 + 动画起跑
  const cost = await trace(4000);
  // 循环接缝：周期 = 时长（alternate 则 ×2），取最短的那套作为「圈」
  const periods = th.dur.map((d, i) => (th.alt[i] ? d * 2 : d));
  const P = th.P ?? Math.max(...periods);
  await freeze(0);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/${th.id}-t0.png` });
  // 比 t=0 与 t=周期+1ms：正好跨过循环点，两帧应当是同一个状态。
  // ⚠ 不能用「周期-50ms」：那本身含 50ms 的运动量（雨丝 50ms 走 5px），测出来是相位差不是接缝。
  await freeze(P + 0.001);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/${th.id}-tEnd.png` });
  await thaw();
  rows.push({ id: th.id, note: th.note, P, cost, files: [`${SHOTS}/${th.id}-t0.png`, `${SHOTS}/${th.id}-tEnd.png`] });
  const f = (k) => cost[k] ? `${cost[k].ms}ms/${cost[k].n}` : "—";
  console.log(`${th.id.padEnd(10)} 周期${String(P).padStart(4)}s  Paint ${f("Paint").padEnd(14)} 光栅 ${f("RasterTask").padEnd(14)} 样式 ${f("UpdateLayoutTree").padEnd(14)} 合成 ${f("CompositeLayers")}`);
}
await browser.close();

// ── 接缝比较 ──
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
console.log("\n循环接缝（t=0 与 t=周期-50ms 两帧的差异；越小越接近无缝）：");
for (const r of rows) {
  const A = decodePng(r.files[0]), B = decodePng(r.files[1]);
  if (A.w !== B.w) { console.log(`  ${r.id}: 尺寸不一致`); continue; }
  let sum = 0, over16 = 0, max = 0;
  for (let i = 0; i < A.w * A.h; i += 1) {
    const o = i * A.ch;
    const d = Math.max(Math.abs(A.data[o] - B.data[o]), Math.abs(A.data[o + 1] - B.data[o + 1]), Math.abs(A.data[o + 2] - B.data[o + 2]));
    sum += d; if (d > 16) over16 += 1; max = Math.max(max, d);
  }
  const px = A.w * A.h;
  const avg = +(sum / px).toFixed(2);
  const verdict = avg < 1.5 ? "无缝" : avg < 6 ? "轻微错位" : "明显跳变";
  console.log(`  ${r.id.padEnd(10)} 平均差 ${String(avg).padStart(6)}/255 · 差>16 像素 ${(over16 / px * 100).toFixed(2)}% · 峰值 ${max}  → ${verdict}`);
}
console.log(`\n截图：${SHOTS}/{主题}-{t0,tEnd}.png。页面错误 ${errs.length}`);

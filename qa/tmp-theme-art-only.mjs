/**
 * qa/tmp-theme-art-only.mjs — 把界面内容隐藏，只留主题背景，量「主题画面本身」：
 *   · 明度极差 / 标准差 = 画面里有多少东西可看
 *   · 与其它主题的差异 = 各主题之间辨识度
 * 同时输出一张「只有背景」的联络表，供人眼评估美术。
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const D = "qa/tmp-theme-audit";
mkdirSync(D, { recursive: true });
const THEMES = ["light", "dark", "eye", "mono", "rain", "bamboo", "snow", "porcelain", "plum", "jiangnan", "firefly", "rice", "pixel", "cyber", "blackgold", "pale", "kawaii", "aurora", "deepsea", "baroque"];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await page.goto("http://localhost:5212/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
// 藏掉 app-shell 的所有子元素（背景在 .app-shell 自己身上，仍在）与顶部/底部固定层
await page.addStyleTag({ content: `.app-shell > *{visibility:hidden !important} .topbar,.bottom-nav,.snow-layer{visibility:hidden !important}` });
for (const t of THEMES) {
  await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, t);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${D}/art-${t}.png` });
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
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) { rgba[i * 4] = out[i * ch]; rgba[i * 4 + 1] = out[i * ch + 1]; rgba[i * 4 + 2] = out[i * ch + 2]; rgba[i * 4 + 3] = 255; }
  return { w, h, data: rgba };
}
function encodePng({ w, h, data }) {
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, payload) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    const t = Buffer.from(type, "ascii");
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(Buffer.concat([t, payload])));
    return Buffer.concat([len, t, payload, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const rawOut = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y += 1) { rawOut[y * (stride + 1)] = 0; data.copy(rawOut, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rawOut, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
const scaleTo = (img, tw) => {
  const th = Math.round(img.h * (tw / img.w));
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y += 1) for (let x = 0; x < tw; x += 1) {
    const sx = Math.min(img.w - 1, Math.floor(x * img.w / tw)), sy = Math.min(img.h - 1, Math.floor(y * img.h / th));
    const o = (sy * img.w + sx) * 4, q = (y * tw + x) * 4;
    out[q] = img.data[o]; out[q + 1] = img.data[o + 1]; out[q + 2] = img.data[o + 2]; out[q + 3] = 255;
  }
  return { w: tw, h: th, data: out };
};

const imgs = {};
for (const t of THEMES) imgs[t] = decodePng(`${D}/art-${t}.png`);

console.log("主题画面本身（界面全部隐藏后）：");
console.log("主题        平均色              明度极差  明度标准差  与最近的另一主题的差异");
const stats = [];
for (const t of THEMES) {
  const img = imgs[t];
  let r = 0, g = 0, b = 0, n = 0, min = 255, max = 0;
  const lums = [];
  for (let i = 0; i < img.w * img.h; i += 1) {
    const o = i * 4;
    r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n += 1;
    const l = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3;
    lums.push(l);
    if (l < min) min = l; if (l > max) max = l;
  }
  const mean = lums.reduce((a, x) => a + x, 0) / lums.length;
  const sd = Math.sqrt(lums.reduce((a, x) => a + (x - mean) ** 2, 0) / lums.length);
  stats.push({ t, mean: `rgb(${(r / n).toFixed(0)},${(g / n).toFixed(0)},${(b / n).toFixed(0)})`, range: +(max - min).toFixed(0), sd: +sd.toFixed(1) });
}
// 两两差异，取每套主题「最像谁」
const pair = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.w * a.h; i += 7) { const o = i * 4; s += (Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2])) / 3; }
  return s / Math.ceil(a.w * a.h / 7);
};
for (const st of stats) {
  let best = null;
  for (const other of THEMES) {
    if (other === st.t) continue;
    const d = pair(imgs[st.t], imgs[other]);
    if (!best || d < best.d) best = { other, d: +d.toFixed(1) };
  }
  console.log(`${st.t.padEnd(11)} ${st.mean.padEnd(20)} ${String(st.range).padStart(5)}   ${String(st.sd).padStart(8)}   ${best.other}（差 ${best.d}）`);
}
// 联络表
const CW = 190;
const cells = THEMES.map((t) => scaleTo(imgs[t], CW));
const CH = cells[0].h, COLS = 5, GAP = 6, PAD = 6;
const rows = Math.ceil(cells.length / COLS);
const W = CW * COLS + GAP * (COLS - 1) + PAD * 2, H = CH * rows + GAP * (rows - 1) + PAD * 2;
const canvas = Buffer.alloc(W * H * 4, 0x11);
for (let i = 0; i < W * H; i += 1) canvas[i * 4 + 3] = 255;
cells.forEach((im, i) => {
  const ox = PAD + (i % COLS) * (CW + GAP), oy = PAD + Math.floor(i / COLS) * (CH + GAP);
  for (let y = 0; y < im.h; y += 1) im.data.copy(canvas, ((oy + y) * W + ox) * 4, y * im.w * 4, (y + 1) * im.w * 4);
});
writeFileSync(`${D}/art-sheet.png`, encodePng({ w: W, h: H, data: canvas }));
console.log(`\n只有背景的联络表：${D}/art-sheet.png`);

/**
 * qa/theme-motion-strip.mjs — 连拍三帧做成胶片条：看运动是不是「各自运动」。
 * 若三个元素在两帧间位移方向/幅度都不同 → 不是整体平移（机械运动）。用法：node qa/theme-motion-strip.mjs [base]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
const D = "qa/tmp-theme-audit";
mkdirSync(D, { recursive: true });
const BASE = process.argv[2] ?? "http://localhost:5212/?qa=1";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const shot = async (theme, i) => {
  const f = `${D}/strip-${theme}-${i}.png`;
  await page.screenshot({ path: f });
  return f;
};
for (const t of ["firefly", "bamboo", "aurora"]) {
  await page.evaluate((id) => { document.documentElement.dataset.theme = id; }, t);
  await page.waitForTimeout(1500);
  // 把动画暂停在三个时间点，保证可复现（不用真实等待，避免帧率影响）
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate((k) => {
      for (const a of document.getAnimations()) {
        const d = a.effect.getTiming().duration || 3000;
        a.currentTime = (Number(a.effect.getTiming().delay) || 0) + d * (0.12 + k * 0.17);
        a.pause();
      }
    }, i);
    await page.waitForTimeout(180);
    await shot(t, i);
  }
  await page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });
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
/** 只取可见带（内容下方 1/3），缩到 1/2 */
function band(file) {
  const img = decodePng(file);
  const y0 = Math.round(img.h * 0.68), bh = Math.round(img.h * 0.30);
  const nw = Math.round(img.w / 2), nh = Math.round(bh / 2);
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y += 1) for (let x = 0; x < nw; x += 1) {
    const sx = Math.min(img.w - 1, x * 2), sy = Math.min(img.h - 1, y0 + y * 2);
    const o = (sy * img.w + sx) * 4, q = (y * nw + x) * 4;
    out[q] = img.data[o]; out[q + 1] = img.data[o + 1]; out[q + 2] = img.data[o + 2]; out[q + 3] = 255;
  }
  return { w: nw, h: nh, data: out };
}
const rows = ["firefly", "bamboo", "aurora"].map((t) => [0, 1, 2].map((i) => band(`${D}/strip-${t}-${i}.png`)));
const CW = rows[0][0].w, CH = rows[0][0].h, GAP = 6, PAD = 6;
const W = CW * 3 + GAP * 2 + PAD * 2, H = CH * 3 + GAP * 2 + PAD * 2;
const canvas = Buffer.alloc(W * H * 4, 0x14);
for (let i = 0; i < W * H; i += 1) canvas[i * 4 + 3] = 255;
rows.forEach((row, r) => row.forEach((im, c) => {
  const ox = PAD + c * (CW + GAP), oy = PAD + r * (CH + GAP);
  for (let y = 0; y < im.h; y += 1) im.data.copy(canvas, ((oy + y) * W + ox) * 4, y * im.w * 4, (y + 1) * im.w * 4);
}));
writeFileSync(`${D}/motion-strip.png`, encodePng({ w: W, h: H, data: canvas }));
console.log(`已生成 ${D}/motion-strip.png（${W}×${H}）`);
console.log("  行 = 萤火森林 / 水墨竹林 / 极光；列 = 同一主题的三个时间点（隔约 0.5–1.7 秒）");

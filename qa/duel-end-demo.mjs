/**
 * qa/duel-end-demo.mjs — 同页同题、只切 CSS 的对照图（用户 10-07「给我看看对比效果」）。
 * 产出 qa/tmp-duel-ab/demo.png：
 *   第 1 行：负局**整屏**——左=旧（暗角灰溢出屏）右=新（干净），就是用户报的那块灰
 *   第 2~4 行：胜/负/和 卡片——左=旧波浪 / 右=新平移（同相位冻结，形状一致）
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
mkdirSync("qa/tmp-duel-ab", { recursive: true });
const D = "qa/tmp-duel-ab";

const OLD_VIGNETTE = `.duel-end-vignette{position:absolute;inset:-26px;border-radius:34px;pointer-events:none;background:radial-gradient(circle at 50% 46%,transparent 40%,#05070a8c 82%)}`;
const OLD_INF = {
  won: `@keyframes duel-end-wave-won{0%{clip-path:path("M0,120 C60,86 120,132 190,104 C250,80 300,116 344,92 L344,400 L0,400 Z")}100%{clip-path:path("M0,98 C62,134 122,78 192,126 C252,152 302,88 344,118 L344,400 L0,400 Z")}}
.duel-end--won .duel-end-flow{animation:duel-end-wave-won 5s .5s ease-in-out infinite alternate !important}`,
  lost: `@keyframes duel-end-wave-lost{0%{clip-path:path("M0,0 L344,0 L344,120 C292,146 242,104 182,132 C122,160 62,120 0,142 Z")}100%{clip-path:path("M0,0 L344,0 L344,142 C296,110 240,158 180,124 C120,94 60,142 0,112 Z")}}
.duel-end--lost .duel-end-flow{animation:duel-end-wave-lost 5.6s .5s ease-in-out infinite alternate !important}`,
};
const INF_NAMES = ["duel-end-wave-won", "duel-end-wave-lost", "duel-end-sway", "duel-end-sway-down"];
const ISOLATE = `.duel-end-halo i,.duel-end-dust i,.duel-end-stamp,.duel-end-stamp i,.duel-end-stroke,.duel-end-poem i,.duel-end-sub,.duel-end-hint,.duel-end-card{animation:none!important}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: "block" });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const clickSel = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) { el.click(); return true; } return false; }, sel);
const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(150); } };
const style = (id, css) => page.evaluate(([i, c]) => {
  document.getElementById(i)?.remove();
  if (!c) return;
  const el = document.createElement("style"); el.id = i; el.textContent = c; document.head.appendChild(el);
}, [id, css]);
const setOutcome = (o) => page.evaluate((oc) => {
  const el = document.querySelector(".duel-end");
  el.classList.remove("duel-end--won", "duel-end--lost", "duel-end--draw");
  el.classList.add(`duel-end--${oc}`);
  const s = el.querySelector(".duel-end-stamp"); if (s) s.childNodes[0].nodeValue = oc === "won" ? "胜" : oc === "lost" ? "负" : "和";
}, o);
const freezeInf = (t) => page.evaluate(([tt, names]) => {
  let n = 0;
  for (const a of document.getAnimations()) if (names.includes(a.animationName)) { a.currentTime = tt * 1000; a.pause(); n += 1; }
  return n;
}, [t, INF_NAMES]);
const thaw = () => page.evaluate((names) => { for (const a of document.getAnimations()) if (names.includes(a.animationName)) a.play(); }, INF_NAMES);

await page.goto("http://localhost:5212/?qa=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2200);
await page.evaluate(() => { const n = document.querySelector('nav[aria-label="主导航"]'); Array.from(n.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "对弈")?.click(); });
await page.waitForTimeout(500);
await clickSel('[data-duel-entry="ai"] button'); await page.waitForTimeout(1200);
await clickSel(".ai-start-button");
await waitFor(async () => Boolean(await page.$("[data-duel-screen]")), 40000);
await page.waitForTimeout(1200);
await clickSel("[data-duel-resign]"); await page.waitForTimeout(400); await clickSel("[data-duel-confirm-ok]");
await waitFor(async () => Boolean(await page.$("[data-duel-result]")), 30000);
await page.waitForTimeout(2600);
await style("iso", ISOLATE);

// ── 第 1 行：负局整屏（暗角溢出）──
await setOutcome("lost");
await style("vig", OLD_VIGNETTE);
await page.waitForTimeout(400);
await page.screenshot({ path: `${D}/demo-screen-lost-old.png` });
await style("vig", "");
await page.waitForTimeout(400);
await page.screenshot({ path: `${D}/demo-screen-lost-new.png` });

// ── 第 2~4 行：三态卡片，同相位冻结 ──
const PLAN = { won: [0.5, 1.9], lost: [0.5, 1.9], draw: [0, 0] };
for (const outcome of ["won", "lost", "draw"]) {
  await setOutcome(outcome);
  await page.waitForTimeout(300);
  // 旧
  if (outcome !== "draw") await style("oldinf", OLD_INF[outcome]);
  await freezeInf(PLAN[outcome][0]);
  await page.waitForTimeout(200);
  await page.locator(".duel-end-card").screenshot({ path: `${D}/demo-${outcome}-old.png` });
  await thaw();
  await style("oldinf", "");
  await page.waitForTimeout(300);
  // 新
  await freezeInf(PLAN[outcome][1]);
  await page.waitForTimeout(200);
  await page.locator(".duel-end-card").screenshot({ path: `${D}/demo-${outcome}-new.png` });
  await thaw();
  await page.waitForTimeout(200);
}
await browser.close();

// ── 合成 ──
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
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(Buffer.concat([t, payload])));
    return Buffer.concat([len, t, payload, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const rawOut = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y += 1) { rawOut[y * (stride + 1)] = 0; data.copy(rawOut, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rawOut, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
const crop = (img, x0, y0, cw, chh) => {
  const out = Buffer.alloc(cw * chh * 4);
  for (let y = 0; y < chh; y += 1) img.data.copy(out, y * cw * 4, ((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + cw) * 4);
  return { w: cw, h: chh, data: out };
};
const scale2 = (img) => { // 1/2 缩小
  const nw = Math.floor(img.w / 2), nh = Math.floor(img.h / 2);
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y += 1) for (let x = 0; x < nw; x += 1) {
    for (let k = 0; k < 4; k += 1) {
      const o = ((y * 2) * img.w + x * 2) * 4 + k, o2 = ((y * 2) * img.w + x * 2 + 1) * 4 + k, o3 = ((y * 2 + 1) * img.w + x * 2) * 4 + k, o4 = ((y * 2 + 1) * img.w + x * 2 + 1) * 4 + k;
      out[(y * nw + x) * 4 + k] = Math.round((img.data[o] + img.data[o2] + img.data[o3] + img.data[o4]) / 4);
    }
  }
  return { w: nw, h: nh, data: out };
};

// 第 1 行：整屏取卡片区域（含四周溢出），缩到 1/2
const vOld = scale2(crop(decodePng(`${D}/demo-screen-lost-old.png`), 10, 480, 764, 800));
const vNew = scale2(crop(decodePng(`${D}/demo-screen-lost-new.png`), 10, 480, 764, 800));
const row1 = [vOld, vNew];
const RW = vOld.w, RH = vOld.h;
// 第 2~4 行：卡片
const rows = [["won", "lost", "draw"].map((o) => [decodePng(`${D}/demo-${o}-old.png`), decodePng(`${D}/demo-${o}-new.png`)])][0];
const CW = rows[0][0].w, CHh = rows[0][0].h;
const GAP = 12, PAD = 12;
const W = Math.max(RW * 2 + GAP, CW * 2 + GAP) + PAD * 2;
const H = RH + GAP + (CHh * 3 + GAP * 2) + PAD * 2;
const canvas = Buffer.alloc(W * H * 4, 0x1e);
for (let i = 0; i < W * H; i += 1) canvas[i * 4 + 3] = 255;
const put = (im, ox, oy) => { for (let y = 0; y < im.h; y += 1) im.data.copy(canvas, ((oy + y) * W + ox) * 4, y * im.w * 4, (y + 1) * im.w * 4); };
put(vOld, PAD, PAD); put(vNew, PAD + RW + GAP, PAD);
let y = PAD + RH + GAP;
for (const [o, n] of rows) { put(o, PAD, y); put(n, PAD + CW + GAP, y); y += CHh + GAP; }
writeFileSync(`${D}/demo.png`, encodePng({ w: W, h: H, data: canvas }));
console.log(`已生成 ${D}/demo.png（${W}×${H}）`);
console.log("  第 1 行（整屏·负局）：左=旧（暗角灰溢出到棋盘上） / 右=新（干净）");
console.log("  第 2~4 行（卡片·胜/负/和）：左=旧波浪 / 右=新平移（同相位，形状一致）");

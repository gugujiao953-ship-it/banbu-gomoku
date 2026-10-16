/**
 * verify-shots.mjs — 素材程序化体检（无视觉也能验）
 * 对 stills/ 和 seq/ 每张 PNG：
 *   - 尺寸（应为 1170×2532 即 390×844@3x，有例外则记录）
 *   - 非空白像素占比（<8% 判定疑似空白/黑屏）
 *   - 平均亮度与饱和度（全黑=0、全白=1、灰蒙蒙提示异常）
 * 输出可疑清单，人工再查。
 */
import { chromium } from "playwright";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const W = 1170, H = 2532; // 390×844 @3x

const dirs = ["stills", "seq/play", "seq/analysis", "seq/theme", "seq/jiutian"];
const files = [];
for (const d of dirs) {
  const full = path.join(ROOT, d);
  let names = [];
  try { names = await readdir(full); } catch { continue; }
  for (const n of names.filter(n => n.endsWith(".png"))) files.push(path.join(full, n));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const bad = [];
let okSize = 0, okContent = 0;

for (const f of files) {
  const b64 = (await readFile(f)).toString("base64");
  const info = await page.evaluate(async ({ b64, f }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode().catch(() => null);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonBlank = 0, lum = 0, sat = 0;
    const step = Math.max(1, Math.floor(d.length / 4 / 30000));
    for (let i = 0; i < d.length; i += 4 * step) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const L = (r + g + b) / 3;
      lum += L / 255;
      if (mx - mn > 12 || L > 6) nonBlank++;
      sat += (mx === 0 ? 0 : (mx - mn) / mx);
    }
    const n = Math.ceil(d.length / 4 / step);
    return { w: c.width, h: c.height, nonBlank: nonBlank / n, lum: lum / n, sat: sat / n };
  }, { b64, f });

  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  const sizeOk = info.w === W && info.h === H;
  if (sizeOk) okSize++;
  const contentOk = info.nonBlank > 0.08;
  if (contentOk) okContent++;
  const flags = [];
  if (!sizeOk) flags.push(`尺寸 ${info.w}×${info.h}`);
  if (!contentOk) flags.push(`空白比 ${(info.nonBlank * 100).toFixed(1)}%`);
  if (info.lum < 0.03) flags.push("全黑");
  if (info.lum > 0.97) flags.push("全白");
  if (flags.length) bad.push([rel, flags.join(", "), `lum=${info.lum.toFixed(2)} sat=${info.sat.toFixed(2)}`]);
}

console.log(`素材 ${files.length} 张：尺寸OK ${okSize} / 内容OK ${okContent}`);
if (bad.length === 0) console.log("✅ 全部通过");
else {
  console.log(`⚠️ 可疑 ${bad.length} 张:`);
  for (const [rel, fl, extra] of bad) console.log("  ", rel, "::", fl, extra);
}
await browser.close().catch(() => {});
process.exit(0);